# Worker Relay

Invite-only MVP for routing AI text jobs from a Railway-hosted coordinator to approved computers or VPS workers.

## Current scope

- Private web inbox protected by a beta access key.
- PostgreSQL-backed job queue on Railway.
- Atomic leases with expiry and stale-result rejection.
- Friend-operated outbound-only worker agent.
- Ollama adapter with a fixed operator-selected model.
- No token, payment, NFT, wallet, arbitrary user code, or public worker enrollment.

## Architecture

```text
Browser -> Railway API -> Railway PostgreSQL
                         ^
                         |
                  friend PC / VPS
                  worker + Ollama
```

The worker receives a prompt only after claiming a time-limited lease. It never receives database credentials or Railway administration access.

## Local coordinator

```bash
npm install
npm run build
```

Set `USER_ACCESS_TOKEN`, `ADMIN_ACCESS_TOKEN`, and `WORKER_ACCESS_TOKEN`, then:

```bash
npm start
```

Open `http://localhost:3000` and enter the user access token.

## Local worker

Install and start Ollama, pull an approved model, then configure:

```text
COORDINATOR_URL=https://your-service.up.railway.app
WORKER_ACCESS_TOKEN=...
WORKER_NAME=friend-worker-1
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2
```

Run one job:

```bash
npm run worker -- --once
```

Run continuously:

```bash
npm run worker
```

See `docs/WORKER_SETUP.md` for Windows and VPS instructions.

## Verification

```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

## Security boundary

This beta accepts text instructions only. Assigned workers can read assigned prompts. Do not submit credentials, regulated data, private keys, confidential repositories, or personal documents. The current access-key login is suitable for a small invited beta, not public multi-tenant production.
