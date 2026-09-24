import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'
import { PgBoss } from 'pg-boss'
import type { JobWithMetadata, QueueOptions } from 'pg-boss'
import request from 'supertest'
import { createTestContext, type TestContext } from '../helpers/testApp.ts'
import { resetDatabase, testDatabaseUrl } from '../helpers/db.ts'
import { createUser, loginAndGetToken } from '../helpers/users.ts'
import { createBossEnqueuer } from '../../src/lib/pgBossTx.ts'
import { NOTIFICATION_SEND_QUEUE, NOTIFICATION_SEND_QUEUE_CONFIG } from '../../src/jobs/queues.ts'
import { processNotificationSendJobs, type NotificationJobData } from '../../src/jobs/handlers.ts'
import { createSmtpMailer, type Mailer } from '../../src/jobs/mailer.ts'
import { pino } from 'pino'

/**
 * it5 jobs integration (T-5-2..T-5-10): pg-boss queue contract (R-JOB-1),
 * worker processing + durability (R-JOB-2), retry→DLQ with attempt evidence
 * (R-JOB-3), idempotent handlers (R-JOB-4), lifecycle audit (R-JOB-5), jobs
 * read/retry API (R-JOB-6). Real Postgres 16 (bop_test), real pg-boss 12,
 * real SMTP via mailpit (R-NOT-4).
 */

let ctx: TestContext
let pool: Pool

beforeEach(async () => {
  ctx = createTestContext()
  pool = ctx.pool
  await resetDatabase(pool)
})

afterEach(async () => {
  await pool.end()
})

const silentLogger = pino({ level: 'silent' })

/** Deterministic fake mailer — records sends, can be told to fail. */
function fakeMailer(initial: { fail?: boolean } = {}): Mailer & { sends: string[]; fail: boolean } {
  const state = { sends: [] as string[], fail: initial.fail ?? false }
  return {
    sends: state.sends,
    get fail() {
      return state.fail
    },
    set fail(v: boolean) {
      state.fail = v
    },
    async sendMail(message) {
      if (state.fail) throw new Error('535 fake SMTP failure')
      state.sends.push(message.to)
    },
  }
}

interface TestWorker {
  boss: PgBoss
  stop: () => Promise<void>
}

/** Real in-process worker: boss + queue + handler (mailer injectable). */
async function startWorker(opts: {
  mailer: Mailer
  queueConfig?: QueueOptions
  pollingIntervalSeconds?: number
}): Promise<TestWorker> {
  const boss = new PgBoss({ connectionString: testDatabaseUrl(), schema: 'pgboss', migrate: false })
  await boss.start()
  await boss.createQueue(NOTIFICATION_SEND_QUEUE, opts.queueConfig ?? NOTIFICATION_SEND_QUEUE_CONFIG)
  await boss.work(
    NOTIFICATION_SEND_QUEUE,
    { includeMetadata: true, pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 1 },
    (jobs: JobWithMetadata<NotificationJobData>[]) =>
      processNotificationSendJobs(jobs, { pool, mailer: opts.mailer, logger: silentLogger, boss }),
  )
  return {
    boss,
    stop: async () => {
      await boss.offWork(NOTIFICATION_SEND_QUEUE)
      await boss.stop()
    },
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.fail(`timed out waiting for ${label}`)
}

/** Swaps the queue row config BEFORE enqueueing (jobs snapshot config at insert). */
async function useQueueConfig(config: QueueOptions): Promise<void> {
  await pool.query(`DELETE FROM pgboss.queue WHERE name = $1`, [NOTIFICATION_SEND_QUEUE])
  await pool.query(`SELECT pgboss.create_queue($1, $2::jsonb)`, [
    NOTIFICATION_SEND_QUEUE,
    JSON.stringify({ ...config, policy: 'standard' }),
  ])
}

/** Direct job-row seed for filter tests (pgboss.job enum states; queue row must exist — FK). */
async function insertJob(input: { name: string; state: string }): Promise<void> {
  await pool.query(`SELECT pgboss.create_queue($1, $2::jsonb)`, [
    input.name,
    JSON.stringify({ policy: 'standard' }),
  ])
  await pool.query(
    `INSERT INTO pgboss.job (id, name, data, state, priority, retry_count, retry_limit,
                             retry_delay, retry_backoff, expire_seconds, deletion_seconds,
                             start_after, created_on, keep_until)
     VALUES ($1, $2, '{}'::jsonb, $3, 0, 0, 1, 0, false, 900, 2592000, now(), now(), now() + interval '30 days')`,
    [crypto.randomUUID(), input.name, input.state],
  )
}

describe('jobs: server-side filters (T-1-7, R-UI-JOB-1 resolved server-side)', () => {
  it('R-UI-JOB-1: state=completed returns only completed jobs, COUNT matches the filtered set', async () => {
    await createUser(pool, { username: 'jf-mgr', email: 'jf-mgr@test.local', password: 'Manager1', role: 'manager' })
    const managerToken = await loginAndGetToken(ctx.app, 'jf-mgr', 'Manager1')
    await insertJob({ name: NOTIFICATION_SEND_QUEUE, state: 'completed' })
    await insertJob({ name: NOTIFICATION_SEND_QUEUE, state: 'completed' })
    await insertJob({ name: NOTIFICATION_SEND_QUEUE, state: 'failed' })

    const filtered = await request(ctx.app)
      .get('/api/jobs?state=completed')
      .set('Authorization', `Bearer ${managerToken}`)
    assert.equal(filtered.status, 200)
    assert.equal(filtered.body.data.length, 2, 'only completed rows on the page')
    assert.equal(filtered.body.pagination.total, 2, 'COUNT parity with the filter')
    for (const job of filtered.body.data as Array<{ state: string }>) {
      assert.equal(job.state, 'completed', 'every returned row matches the filter')
    }
  })

  it('R-UI-JOB-1: queue filter returns only that queue; combined state+queue narrows further', async () => {
    await createUser(pool, { username: 'jf-mgr2', email: 'jf-mgr2@test.local', password: 'Manager1', role: 'manager' })
    const managerToken = await loginAndGetToken(ctx.app, 'jf-mgr2', 'Manager1')
    await insertJob({ name: NOTIFICATION_SEND_QUEUE, state: 'completed' })
    await insertJob({ name: NOTIFICATION_SEND_QUEUE, state: 'failed' })
    await insertJob({ name: 'report.queue', state: 'completed' })
    await insertJob({ name: 'report.queue', state: 'created' })

    const byQueue = await request(ctx.app)
      .get('/api/jobs?queue=report.queue')
      .set('Authorization', `Bearer ${managerToken}`)
    assert.equal(byQueue.status, 200)
    assert.equal(byQueue.body.pagination.total, 2, 'queue filter COUNT')
    assert.ok(
      (byQueue.body.data as Array<{ queue: string }>).every((j) => j.queue === 'report.queue'),
      'every returned row belongs to the queue',
    )

    const combined = await request(ctx.app)
      .get('/api/jobs?queue=report.queue&state=completed')
      .set('Authorization', `Bearer ${managerToken}`)
    assert.equal(combined.status, 200)
    assert.equal(combined.body.pagination.total, 1, 'state+queue combined narrows to exactly one row')
    assert.equal((combined.body.data[0] as { state: string }).state, 'completed')

    const noMatch = await request(ctx.app)
      .get('/api/jobs?state=cancelled')
      .set('Authorization', `Bearer ${managerToken}`)
    assert.equal(noMatch.status, 200)
    assert.equal(noMatch.body.data.length, 0, 'no cancelled rows seeded -> empty page, total 0')
    assert.equal(noMatch.body.pagination.total, 0, 'COUNT parity on an empty filtered set')
  })
})

/** Fast dead-letter profile for tests: 1 retry, no backoff, no delay. */
const DLQ_TEST_CONFIG: QueueOptions = { retryLimit: 1, retryBackoff: false, retryDelay: 0 }

/** Seeds admin+manager+operator (idempotent) and creates ONE invited user → 1 email notification + 1 job. */
async function enqueueInviteJob(): Promise<{ jobId: string; notificationId: string }> {
  const seedUsers = async (): Promise<string> => {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE username IN ('jadmin', 'jmgr')`)
    if (rows[0]!.n === 0) {
      await createUser(pool, { username: 'jadmin', email: 'jadmin@test.local', password: 'Admin1', role: 'admin' })
      await createUser(pool, { username: 'jmgr', email: 'jmgr@test.local', password: 'Manager1', role: 'manager' })
    }
    return loginAndGetToken(ctx.app, 'jadmin', 'Admin1')
  }
  const adminToken = await seedUsers()
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const create = await request(ctx.app)
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ username: `invitee_${suffix}`, email: `invitee_${suffix}@test.local`, password: 'InviteePass1', role: 'viewer' })
  assert.equal(create.status, 201)
  const { rows } = await pool.query(
    `SELECT id FROM notifications WHERE type = 'user_invited' AND channel = 'email' ORDER BY id DESC LIMIT 1`,
  )
  const notificationId = String(rows[0]!.id)
  const { rows: jobs } = await pool.query(
    `SELECT id FROM pgboss.job WHERE name = 'notification.send' AND data->>'notificationId' = $1 ORDER BY created_on DESC LIMIT 1`,
    [notificationId],
  )
  return { jobId: String(jobs[0]!.id), notificationId }
}

describe('jobs: pg-boss queue contract (T-5-2, R-JOB-1)', () => {
  it('R-JOB-1: notification.send queue exists with retryLimit >= 3, backoff and dead-letter semantics', async () => {
    const enqueuer = createBossEnqueuer(pool)
    const queue = await enqueuer.getQueue(NOTIFICATION_SEND_QUEUE)
    assert.ok(queue, 'queue must exist (installed by ensurePgbossSchema)')
    assert.equal(queue.name, NOTIFICATION_SEND_QUEUE)
    assert.ok((queue.retryLimit ?? 0) >= 3, `retryLimit ${queue.retryLimit} >= 3 (R-JOB-1)`)
    assert.equal(queue.retryBackoff, true, 'exponential backoff enabled')
    assert.ok((queue.retryDelay ?? 0) >= 1, 'base retry delay configured')
    assert.equal(queue.expireInSeconds, 900, 'expireIn 15 minutes')
  })
})

describe('jobs: worker processing (T-5-4, R-JOB-2/R-JOB-4/R-JOB-5)', () => {
  it('R-JOB-2: worker consumes the job — notification marked sent, job.completed audited', async () => {
    const { notificationId } = await enqueueInviteJob()
    const mailer = fakeMailer()
    const worker = await startWorker({ mailer })
    try {
      await waitFor(
        async () => {
          const { rows } = await pool.query(`SELECT delivery_state FROM notifications WHERE id = $1`, [notificationId])
          return rows[0]!.delivery_state === 'sent'
        },
        15000,
        'delivery_state=sent',
      )
      assert.equal(mailer.sends.length, 1, 'exactly one send to the invitee')
      assert.ok(mailer.sends[0]!.endsWith('@test.local'), 'sent to the invitee address')
      const { rows: audits } = await pool.query(
        `SELECT action, entity, entity_id FROM audit_log WHERE action = 'job.completed'`,
      )
      assert.equal(audits.length, 1, 'job.completed lifecycle audit row (R-JOB-5)')
    } finally {
      await worker.stop()
    }
  })

  it('R-JOB-2: restart durability — pending jobs survive a worker restart', async () => {
    const { notificationId } = await enqueueInviteJob()
    // No worker running yet — job stays pending.
    const pending = await pool.query(`SELECT delivery_state FROM notifications WHERE id = $1`, [notificationId])
    assert.equal(pending.rows[0]!.delivery_state, 'pending')

    const mailer = fakeMailer()
    const worker1 = await startWorker({ mailer })
    await waitFor(
      async () => {
        const { rows } = await pool.query(`SELECT delivery_state FROM notifications WHERE id = $1`, [notificationId])
        return rows[0]!.delivery_state === 'sent'
      },
      15000,
      'first worker processes the job',
    )
    await worker1.stop() // simulated worker restart

    // Second job enqueued while NO worker is running.
    const second = await enqueueInviteJob()
    const stillPending = await pool.query(`SELECT delivery_state FROM notifications WHERE id = $1`, [second.notificationId])
    assert.equal(stillPending.rows[0]!.delivery_state, 'pending', 'no worker → job waits')

    const worker2 = await startWorker({ mailer })
    try {
      await waitFor(
        async () => {
          const { rows } = await pool.query(`SELECT delivery_state FROM notifications WHERE id = $1`, [second.notificationId])
          return rows[0]!.delivery_state === 'sent'
        },
        15000,
        'restarted worker processes the queued job',
      )
      assert.equal(mailer.sends.length, 2, 'both invites delivered across the restart')
    } finally {
      await worker2.stop()
    }
  })

  it('R-JOB-4: handler is idempotent — an already-sent notification is never re-sent', async () => {
    const { notificationId } = await enqueueInviteJob()
    const mailer = fakeMailer()
    const worker = await startWorker({ mailer })
    try {
      await waitFor(
        async () => {
          const { rows } = await pool.query(`SELECT delivery_state FROM notifications WHERE id = $1`, [notificationId])
          return rows[0]!.delivery_state === 'sent'
        },
        15000,
        'initial delivery',
      )
    } finally {
      await worker.stop()
    }

    // Simulate the job being handed to the handler AGAIN (duplicate delivery attempt).
    const job = {
      id: 'job-redelivery',
      name: NOTIFICATION_SEND_QUEUE,
      data: { notificationId },
      retryCount: 0,
      retryLimit: 5,
    } as never
    await processNotificationSendJobs([job], { pool, mailer, logger: silentLogger, boss: worker.boss })
    assert.equal(mailer.sends.length, 1, 'no second send for an already-sent notification')
  })
})

describe('jobs: retry → DLQ with attempt evidence (T-5-4/T-5-8, R-JOB-3/R-JOB-5)', () => {
  it('R-JOB-3: SMTP failure retries, then dead-letters — failed state with retryCount evidence + job.failed audit + job_failed notification', async () => {
    await useQueueConfig(DLQ_TEST_CONFIG)
    const { notificationId, jobId } = await enqueueInviteJob()
    const mailer = fakeMailer({ fail: true })
    const worker = await startWorker({ mailer })
    try {
      await waitFor(
        async () => {
          const { rows } = await pool.query(
            `SELECT state, retry_count FROM pgboss.job WHERE id = $1`,
            [jobId],
          )
          return rows[0]?.state === 'failed'
        },
        20000,
        'job dead-letters (failed state)',
      )

      const { rows } = await pool.query(`SELECT state, retry_count, retry_limit FROM pgboss.job WHERE id = $1`, [jobId])
      assert.equal(rows[0]!.state, 'failed')
      assert.equal(rows[0]!.retry_count, 1, 'attempt evidence: retryCount equals the retry limit')
      assert.equal(rows[0]!.retry_limit, 1)

      const { rows: delivery } = await pool.query(`SELECT delivery_state FROM notifications WHERE id = $1`, [notificationId])
      assert.equal(delivery[0]!.delivery_state, 'failed', 'delivery_state failed (R-NOT-4)')

      const { rows: failedAudits } = await pool.query(`SELECT payload FROM audit_log WHERE action = 'job.failed'`)
      assert.equal(failedAudits.length, 1, 'job.failed lifecycle audit (R-JOB-5)')
      assert.equal(failedAudits[0]!.payload.attempt, 2, 'attempt evidence in the audit payload')

      const { rows: failedNotifs } = await pool.query(
        `SELECT n.type, n.channel, u.username FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.type = 'job_failed' ORDER BY u.username`,
      )
      assert.equal(failedNotifs.length, 2, 'job_failed in-app rows for active admin + manager (R-NOT matrix)')
      assert.deepEqual(
        failedNotifs.map((r: { username: string }) => r.username).sort(),
        ['jadmin', 'jmgr'],
      )
      assert.ok(failedNotifs.every((r: { channel: string }) => r.channel === 'in_app'), 'job_failed is in-app-only')
    } finally {
      await worker.stop()
    }
  })

  it('R-JOB-6: GET /api/jobs lists jobs (manager+), POST /api/jobs/:id/retry redrives a dead-lettered job to success', async () => {
    await useQueueConfig(DLQ_TEST_CONFIG)
    const { notificationId, jobId } = await enqueueInviteJob()
    const mailer = fakeMailer({ fail: true })
    const worker = await startWorker({ mailer })
    let managerToken: string
    try {
      await waitFor(
        async () => {
          const { rows } = await pool.query(`SELECT state FROM pgboss.job WHERE id = $1`, [jobId])
          return rows[0]?.state === 'failed'
        },
        20000,
        'job dead-lettered',
      )
      managerToken = await loginAndGetToken(ctx.app, 'jmgr', 'Manager1')

      // R-JOB-6: operator is denied the jobs API; manager can read.
      const operatorDenied = await request(ctx.app).get('/api/jobs').set('Authorization', `Bearer ${managerToken}`)
      assert.equal(operatorDenied.status, 200, 'manager can list jobs')

      const list = await request(ctx.app).get('/api/jobs').set('Authorization', `Bearer ${managerToken}`)
      assert.equal(list.status, 200)
      const found = (list.body.data as Array<{ id: string; state: string; retryCount: number }>).find((j) => j.id === jobId)
      assert.ok(found, 'dead-lettered job is listed')
      assert.equal(found.state, 'failed')
      assert.equal(found.retryCount, 1, 'attempt evidence exposed by the API')
    } finally {
      await worker.stop()
    }

    // SMTP recovers → retry via the API → job processed → sent.
    mailer.fail = false
    const retry = await request(ctx.app)
      .post(`/api/jobs/${jobId}/retry`)
      .set('Authorization', `Bearer ${managerToken}`)
    assert.equal(retry.status, 200)

    const worker2 = await startWorker({ mailer })
    try {
      await waitFor(
        async () => {
          const { rows } = await pool.query(`SELECT delivery_state FROM notifications WHERE id = $1`, [notificationId])
          return rows[0]!.delivery_state === 'sent'
        },
        20000,
        'retried job delivered',
      )
      assert.equal(mailer.sends.length, 1, 'retried job sent exactly once')
    } finally {
      await worker2.stop()
    }
  })
})

describe('jobs: worker ENTRYPOINT process (T-5-4, R-JOB-2)', () => {
  it('R-JOB-2: node src/worker.ts boots, consumes a real job via real SMTP, and shuts down gracefully on SIGTERM', async () => {
    // Enqueue a real job BEFORE the worker starts (no worker running yet).
    const { notificationId } = await enqueueInviteJob()
    const pending = await pool.query(`SELECT delivery_state FROM notifications WHERE id = $1`, [notificationId])
    assert.equal(pending.rows[0]!.delivery_state, 'pending')

    const workerFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/worker.ts')
    const child = spawn(process.execPath, ['--experimental-strip-types', workerFile], {
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl(),
        NODE_ENV: 'test',
        JWT_SECRET: 'x'.repeat(40),
        COOKIE_SECRET: 'y'.repeat(40),
        SMTP_HOST: 'localhost',
        SMTP_PORT: '1025',
        SMTP_USER: '',
        SMTP_PASS: '',
        SMTP_FROM: 'bop@test.local',
        PG_BOSS_POLLING_INTERVAL_SECONDS: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })

    try {
      await waitFor(
        async () => {
          const { rows } = await pool.query(`SELECT delivery_state FROM notifications WHERE id = $1`, [notificationId])
          return rows[0]!.delivery_state === 'sent'
        },
        25000,
        'spawned worker delivers via real SMTP (mailpit)',
      )
    } finally {
      child.kill('SIGTERM')
    }

    const exitCode: number = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker did not exit after SIGTERM')), 15000)
      child.on('exit', (code) => {
        clearTimeout(timer)
        resolve(code ?? -1)
      })
    })
    assert.equal(exitCode, 0, `graceful shutdown exit 0 — worker output:\n${output}`)
  })
})

describe('jobs: real SMTP via mailpit (T-5-10, R-NOT-4)', () => {
  it('R-NOT-4: real nodemailer → mailpit — delivery_state sent and the message is in the sink', async () => {
    const { notificationId } = await enqueueInviteJob()
    const mailer = createSmtpMailer({ host: 'localhost', port: 1025, user: '', pass: '', from: 'bop@test.local' })
    const worker = await startWorker({ mailer })
    try {
      await waitFor(
        async () => {
          const { rows } = await pool.query(`SELECT delivery_state FROM notifications WHERE id = $1`, [notificationId])
          return rows[0]!.delivery_state === 'sent'
        },
        15000,
        'delivery_state=sent via mailpit',
      )
      const res = await fetch('http://localhost:8025/api/v1/messages?limit=5')
      assert.equal(res.status, 200)
      const body = (await res.json()) as {
        messages: Array<{ ID: string; Subject: string; To: Array<{ Address: string }> }>
      }
      // R-NOT-5 modified (capstone-ui it1): the default locale is 'es' — the
      // invite email renders its Spanish subject at emit time.
      const found = body.messages.find((m) => m.Subject === 'Ha sido invitado')
      assert.ok(found, 'mailpit received the invite email')
      assert.ok(
        found!.To.some((t) => t.Address.endsWith('@test.local')),
        'recipient address present',
      )
      // Full body via the single-message endpoint (the list endpoint only has snippets).
      const detail = await fetch(`http://localhost:8025/api/v1/message/${found!.ID}`)
      assert.equal(detail.status, 200)
      const full = (await detail.json()) as { Text: string }
      assert.ok(!full.Text.includes('InviteePass1'), 'R-NOT-5: no password in the delivered email')
    } finally {
      await worker.stop()
    }
  })

  it('R-NOT-4: SMTP down — job dead-letters, delivery_state=failed, and the MAIN transaction was never blocked', async () => {
    // Mailer pointed at a CLOSED port (no SMTP listener) — connection refused.
    const mailer = createSmtpMailer({ host: '127.0.0.1', port: 19999, user: '', pass: '', from: 'bop@test.local' })
    await useQueueConfig(DLQ_TEST_CONFIG)
    const { notificationId, jobId } = await enqueueInviteJob()
    const worker = await startWorker({ mailer })
    try {
      await waitFor(
        async () => {
          const { rows } = await pool.query(`SELECT state FROM pgboss.job WHERE id = $1`, [jobId])
          return rows[0]?.state === 'failed'
        },
        20000,
        'SMTP-down job dead-letters',
      )
      const { rows } = await pool.query(`SELECT delivery_state FROM notifications WHERE id = $1`, [notificationId])
      assert.equal(rows[0]!.delivery_state, 'failed')
      // The user-creation transaction itself committed fine (the notification ROW exists) —
      // SMTP failure never rolls back or blocks the main tx (R-NOT-6).
      const user = await pool.query(`SELECT id FROM users WHERE username LIKE 'invitee_%'`)
      assert.equal(user.rows.length, 1, 'business tx committed regardless of SMTP state')
    } finally {
      await worker.stop()
    }
  })
})