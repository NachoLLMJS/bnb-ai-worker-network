# BNB AI Worker Network

Free private beta for routing text, image, and video jobs from a Railway-hosted coordinator to approved computers or VPS workers.

Production: `https://api-production-cc9f.up.railway.app`

## Current scope

- Public Swiss-light homepage, job Explorer, vector worker map, and installation documentation.
- Public job requests without a pre-issued key, with a browser-held per-job tracking token for private results.
- Optional private workspace protected by a beta access key.
- PostgreSQL-backed job queue on Railway.
- Atomic leases with expiry and stale-result rejection.
- Friend-operated outbound-only worker agent.
- Anonymous jobs can be claimed only by workers that explicitly enable `ACCEPT_PUBLIC_REQUESTS=true`.
- Capability-aware workers for Ollama, OpenAI API, Anthropic API, DeepSeek, approved Higgsfield media services, Codex with ChatGPT login, and Claude Code with Claude login.
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

Open `http://localhost:3000`. Public pages and `POST /api/requests` require no login. Anonymous requests are private by default and return a one-time tracking token that the browser keeps in `sessionStorage`. Worker claim and completion endpoints still require the worker access token.

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

This beta accepts text instructions only. Assigned workers can read assigned prompts. Do not submit credentials, regulated data, private keys, confidential repositories, or personal documents. Public submission is rate-limited, private by default, and does not grant access to worker claim or completion endpoints.
