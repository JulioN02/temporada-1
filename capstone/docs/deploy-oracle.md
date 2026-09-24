# Deploy Runbook — Oracle Cloud Always Free (R-PROD-4)

Deploy the BOP appliance on an **Oracle Cloud Always Free VM** (Ampere A1
`VM.Standard.A1.Flex` — 4 OCPUs / 24 GB RAM, $0) following the exact commands
below. No paid VPS, no Docker Hub: the image is pulled from **GHCR**.

> Repo: `business-operations-platform` · Image:
> `ghcr.io/<owner>/business-operations-platform` (tags: `latest`, `v*`, commit shas)

---

## 1. Create the VM (console)

1. Oracle Cloud console → **Compute → Instances → Create instance**.
2. Image: **Ubuntu 24.04** (or 22.04) · Shape: **Ampere A1.Flex** (Always Free).
3. Add your SSH key; create the instance.
4. **Networking → Security List** (default VCN) — add ingress rules:
   - TCP `3000` (API + UI) from `0.0.0.0/0`
   - TCP `8025` (mailpit UI, dev) from your IP
   - TCP `22` (SSH) from your IP

## 2. Install Docker + Compose plugin (one-time)

```bash
ssh ubuntu@<VM_IP>
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker ubuntu
# re-login so the group applies
exit && ssh ubuntu@<VM_IP>
docker --version && docker compose version
```

## 3. Prepare the app directory + env (secrets NEVER committed)

```bash
mkdir -p /opt/bop && cd /opt/bop

# Generate strong secrets locally (>= 32 chars, validated at boot — R-PROD-5)
JWT_SECRET=$(openssl rand -hex 32)
COOKIE_SECRET=$(openssl rand -hex 32)

cat > .env <<EOF
NODE_ENV=production
DATABASE_URL=postgres://postgres:postgres@db:5432/bop
JWT_SECRET=$JWT_SECRET
COOKIE_SECRET=$COOKIE_SECRET
APP_VERSION=1.0.0
SMTP_HOST=<your-smtp-provider-host>
SMTP_PORT=587
SMTP_USER=<your-smtp-user>
SMTP_PASS=<your-smtp-password>
SMTP_FROM=BOP <no-reply@yourdomain.com>
EOF

chmod 600 .env   # owner-only
```

> SMTP: any provider (SendGrid, Brevo, SES…). The worker sends emails only
> (R-NOT-3); the API never touches SMTP credentials at runtime.

## 4. Compose file (image-based appliance)

Save as `/opt/bop/docker-compose.yml` (same structure as the repo compose,
but `image:` instead of `build:` — full file in the repo, minus the
`55437`/`8025` host ports you don't want public):

```yaml
services:
  db:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: postgres, POSTGRES_PASSWORD: postgres, POSTGRES_DB: bop }
    volumes: [db-data:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U postgres -d bop"], interval: 5s, timeout: 5s, retries: 10 }
    restart: unless-stopped
  migrate:
    image: ghcr.io/<owner>/business-operations-platform:latest
    depends_on: { db: { condition: service_healthy } }
    env_file: .env
    environment: { DATABASE_URL: postgres://postgres:postgres@db:5432/bop }
    command: sh -c "node backend/scripts/migrate.ts && node backend/scripts/ensure-queues.ts"
    restart: "no"
  api:
    image: ghcr.io/<owner>/business-operations-platform:latest
    depends_on: { migrate: { condition: service_completed_successfully } }
    ports: ["3000:3000"]
    env_file: .env
    environment: { DATABASE_URL: postgres://postgres:postgres@db:5432/bop }
    restart: unless-stopped
  worker:
    image: ghcr.io/<owner>/business-operations-platform:latest
    depends_on: { migrate: { condition: service_completed_successfully } }
    env_file: .env
    environment: { DATABASE_URL: postgres://postgres:postgres@db:5432/bop }
    command: ["node", "backend/src/worker.ts"]
    restart: unless-stopped
  mailpit:
    image: axllent/mailpit:latest
    ports: ["8025:8025"]   # optional in prod — dev SMTP sink
    restart: unless-stopped
volumes:
  db-data:
```

## 5. Pull + start (exact commands)

```bash
cd /opt/bop
docker pull ghcr.io/<owner>/business-operations-platform:latest
docker compose up -d
# wait for the one-shot migrate to finish, then check health:
docker compose ps
curl -fsS http://localhost:3000/api/health   # → {"status":"ok","db":"up"}
```

The API + UI are now live at `http://<VM_IP>:3000`; API docs at
`http://<VM_IP>:3000/api/docs`.

## 6. Backup (before first deploy + scheduled)

```bash
cd /opt/bop
docker compose exec -T db pg_dump -U postgres -d bop > backup-$(date +%F).sql
# restore (disaster recovery):
cat backup-YYYY-MM-DD.sql | docker compose exec -T db psql -U postgres -d bop
```

Add a cron job for daily dumps (e.g. `crontab -e`):
`0 3 * * * cd /opt/bop && docker compose exec -T db pg_dump -U postgres -d bop > /opt/bop/backups/backup-$(date +\%F).sql`

## 7. Upgrade + rollback

**Upgrade** (image pull → recreate):
```bash
cd /opt/bop
docker pull ghcr.io/<owner>/business-operations-platform:latest
docker compose up -d
```

**Rollback** (keep the previous tag — e.g. the `v*` tag you were on):
```bash
cd /opt/bop
# 1. pin the compose image back to the previous tag (edit docker-compose.yml)
# 2. pull + restart that tag:
docker pull ghcr.io/<owner>/business-operations-platform:<previous-tag>
docker compose up -d
# 3. migrations are additive & idempotent — an old image on a new DB is safe
#    (the _migrations ledger tracks applied files; rollback never re-runs).
# 4. if the DB itself was migrated forward, restore the pre-deploy dump first:
cat backup-<pre-deploy>.sql | docker compose exec -T db psql -U postgres -d bop
```

## 8. Verification checklist

- [ ] `curl http://<VM_IP>:3000/api/health` → `{"status":"ok","db":"up"}`
- [ ] `docker compose ps` shows `api` and `worker` healthy (restart policy covers crashes)
- [ ] Login at `http://<VM_IP>:3000` (admin user created via `POST /api/users`)
- [ ] `/api/docs` renders the Swagger UI
- [ ] Mailpit (or your SMTP provider) receives the `user_invited` email on user creation
- [ ] Confirm an order → notification row + email job → worker delivers (R-ORD-5)