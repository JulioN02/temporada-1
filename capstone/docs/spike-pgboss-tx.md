# SPIKE T-5-1 — pg-boss v12 Atomic Job Insertion (ADR-2 validation)

**Date**: 2026-09-21 · **pg-boss version**: 12.33.2 · **Target**: `bop_test` (PostgreSQL 16 via compose, port 55437)
**Artifact**: scratch `backend/scripts/spike-pgboss.ts` (REMOVED after this spike — see cleanup note) · **Gate**: T-5-2..T-5-10

## Question

Does `boss.send(queue, data, { db: { executeSql } })` — pg-boss v12's "Atomic Job
Insertion" — behave atomically inside the project's `withTransaction`? If a
business transaction rolls back, is the enqueued job row hidden (no orphan
jobs)? If yes, ADR-2 stands (same-tx enqueue, no outbox, no poller, R-NOT-6).
If no, the exactly-once contract (R-NOT-6/R-ORD-5) needs an outbox fallback.

## Method (RED-first)

The spike script was written BEFORE any production code (T-5-2 `lib/pgBossTx.ts`
did not exist). The RED assertion: *rollback → no job visible*, with a positive
control — the in-transaction `send` MUST return a job id before the forced
failure, otherwise "no job visible" is a false positive.

## Results (real output, 2026-09-21)

```
pgboss schema installed; queue created: notification.send
PASS - rollback hides job row (in-tx send id=b685ea68-f979-43b6-b83c-3208e26acfb0)
PASS - committed tx keeps job row (id 6b9310a1-0ec6-4c7d-801b-d782fe572599)
PASS - pre-start enqueuer works (id fb91f790-1bc5-4737-b6e2-327784af496e)

=== SPIKE SUMMARY ===
  [PASS] rollback hides job row (send succeeded in-tx, row gone after rollback)
  [PASS] committed tx keeps exactly 1 job row
  [PASS] enqueue-only boss (never started) sends successfully
  [PASS] schema-qualified pgboss.job insert (pgboss schema)

SPIKE RESULT: SUCCESS — atomic in-tx enqueue works; proceed with T-5-2..T-5-10
```

## Findings

1. **Atomic in-tx enqueue CONFIRMED.** `boss.send` with a tx-scoped `db` adapter
   issues a SINGLE parameterized `INSERT ... SELECT` into `pgboss.job`
   (schema-qualified; verified in `dist/plans.js` `insertJobs()`). Inside
   `withTransaction` it commits with the business tx and rolls back with it.
2. **Exactly-once crash semantics hold**: a failed business tx leaves ZERO job
   rows. Combined with `UNIQUE(type, reference, channel, user_id)` on
   `notifications` (Batch C deviation #1) and `ON CONFLICT DO NOTHING RETURNING
   id` gating the enqueue, replay/retry of a domain event can never double
   enqueue (R-NOT-6, R-JOB-4).
3. **The request path needs a NEVER-STARTED boss instance** backed by a shared
   pool adapter (`{ executeSql: (sql, v) => pool.query(sql, v) }`). A started
   boss runs maintenance timers; a stopped boss CLOSES its pool. Verified:
   enqueue-only boss (never `start()`ed) sends successfully because its queue
   cache lookup also flows through the shared pool adapter.
4. **`stop()` closes the boss pool** (default `close: true`) — and `send()`
   consults the queue cache via the boss's OWN database before inserting through
   the tx adapter. Therefore the worker must keep its boss started while
   handling jobs, and the API's enqueuer must never be stopped.
5. **Queue must exist before send**: `send` throws `Queue ${name} does not
   exist` when the `pgboss.queue` row is missing. Production: worker
   `createQueue` at boot. Test DB: `tests/helpers` bootstraps schema + queue
   (see T-5-2/T-5-10 evidence). API-side lazy `createQueue` is idempotent
   (calls the `pgboss.create_queue` SQL function).

## Concluded atomic enqueue contract (binding for T-5-2..T-5-10)

```
emitEvent(tx, {type, reference, payload, recipientUserIds?}, enqueuer):
  recipients := explicit OR role-resolved (in-tx, ADR-4)
  for channel in NOTIFICATION_TARGETS[type].channels:
    for userId in recipients:
      row := INSERT INTO notifications (user_id, type, channel, title, body, reference)
             ON CONFLICT (type, reference, channel, user_id) DO NOTHING RETURNING id
      if row IS NULL: continue                      # replay — already emitted
      if channel == email:
        jobId := enqueuer.send(QUEUE, {notificationId: row.id}, {db: txAdapter(tx)})
        writeAudit(tx, {action: 'job.created', entity: 'job', entityId: jobId, ...})
COMMIT → all-or-nothing (rows + jobs); ROLLBACK → zero side effects
```

## Cleanup

Spike script `backend/scripts/spike-pgboss.ts` removed after this evidence was
captured (per T-5-1). The `pgboss` schema + `notification.send` queue remain
installed in `bop_test` (idempotent bootstrap, reused by T-5-2..T-5-10 tests).