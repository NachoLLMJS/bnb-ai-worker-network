# BNB AI Worker Network

Free private beta for routing text, image, and video jobs from a Railway-hosted coordinator to approved computers or VPS workers.

Production: `https://api-production-cc9f.up.railway.app`

## Current scope

- Public Swiss-light homepage, job Explorer, vector worker map, and installation documentation.
- Public job requests without a pre-issued key, with a browser-held per-job tracking token for private results.
- Optional private workspace protected by a beta access key.
- PostgreSQL-backed job queue on Railway.
- Atomic leases with expiry and stale-result rejection.
- Friend-operated outbound-only worker agent with individually revocable credentials.
- Anonymous jobs can be claimed only by workers that explicitly enable `ACCEPT_PUBLIC_REQUESTS=true`.
- Capability-aware workers for Ollama, OpenAI API, Anthropic API keys, DeepSeek, approved Higgsfield media services, and Codex with ChatGPT login. Claude consumer subscriptions are not used as worker credentials.
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

Set `USER_ACCESS_TOKEN` and `ADMIN_ACCESS_TOKEN`. The shared `WORKER_ACCESS_TOKEN` is legacy-only and is ignored unless `LEGACY_WORKER_TOKEN_ENABLED=true`; production should leave that flag false.

```bash
npm start
```

Open `http://localhost:3000`. Public pages and `POST /api/requests` require no login. Anonymous requests are private by default and return a one-time tracking token that the browser keeps in `sessionStorage`. Worker claim and completion endpoints require either an individually issued worker credential or the legacy/bootstrap worker token.

## Individual worker credentials

Production stores only SHA-256 hashes of randomly generated 256-bit worker tokens. Each credential has a label, creation time, last-use metadata, and an independent revocation switch. The plaintext token is returned only at issuance.

Issue credentials from an operator machine whose environment securely contains `ADMIN_ACCESS_TOKEN`:

```bash
npm run issue:workers -- --url https://api-production-cc9f.up.railway.app --count 5 --label-prefix "Friend Worker" --worker-prefix friend-worker --output ./worker-credentials.json
```

The command reserves and secures the output file before contacting production, generates each token locally, and registers each credential with an idempotent issuance ID. If a network interruption occurs, rerun the same command with `--resume`; already registered entries are not duplicated. The output file contains secrets. Never commit it, paste it into issues, or share one token with multiple people. Give each operator exactly one `workerId` and token pair through a private channel. They must enter that worker ID as `Worker name` and the token as `Worker access token` in the local dashboard.

Administrative API routes are protected by `ADMIN_ACCESS_TOKEN`:

- `PUT /api/admin/worker-credentials/:issuanceId` idempotently registers one pre-generated, worker-bound credential.
- `GET /api/admin/worker-credentials` lists metadata without token values or hashes.
- `POST /api/admin/worker-credentials/:credentialId/revoke` revokes one credential.

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
