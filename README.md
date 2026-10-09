# BNB AI Worker Network

Free private beta for routing text, image, and video jobs from a Railway-hosted coordinator to approved computers or VPS workers.

Production: `https://api-production-cc9f.up.railway.app`

## Current scope

- Public Swiss-light homepage, job Explorer, vector worker map, and installation documentation.
- Private requester workspace protected by a beta access key.
- PostgreSQL-backed job queue on Railway.
- Atomic leases with expiry and stale-result rejection.
- Friend-operated outbound-only worker agent.
- Capability-aware workers for Ollama, OpenAI, Anthropic, DeepSeek, and approved Higgsfield image/video services.
- Public jobs are explicit opt-in; private is the default.
- No token, payment, NFT, wallet, arbitrary user code, or fabricated worker telemetry.

## Architecture

```text
Browser -> Railway API -> Railway PostgreSQL
                         ^
                         |
                  friend PC / VPS
                  worker + Ollama
```

The worker receives a prompt only after claiming a time-limited lease. Provider keys stay on the worker machine, and the worker never receives database credentials or Railway administration access.

## Local coordinator

```bash
npm install
npm run build
```

Set `USER_ACCESS_TOKEN`, `ADMIN_ACCESS_TOKEN`, and `WORKER_ACCESS_TOKEN`, then:

```bash
npm start
```

Open `http://localhost:3000`. Public pages require no login; submitting or managing jobs requires the user access token.

## Friend-operated workers

The installable worker and all PC/VPS/AI-agent manuals live in a separate public repository:

```text
https://github.com/NachoLLMJS/worker-relay-node
```

Provider credentials remain on the worker machine. Workers advertise an explicit capability allowlist, and the coordinator leases a job only to a worker that enabled the requested service.

## Verification

```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

## Security boundary

This beta accepts text instructions only. Assigned workers can read assigned prompts. Do not submit credentials, regulated data, private keys, confidential repositories, or personal documents. The current access-key login is suitable for a small invited beta, not public multi-tenant production.
