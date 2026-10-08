# Friend worker setup

## Requirements

- A dedicated computer or VPS with no wallets, SSH keys, private repositories, or unrelated credentials.
- Node.js 22 or newer.
- Ollama installed and running.
- An approved model already downloaded.
- Coordinator URL and worker access token supplied privately by the operator.

## Windows

1. Install Node.js and Ollama.
2. Open a terminal in the Worker Relay project.
3. Run `npm ci`.
4. Start Ollama and pull the approved model, for example `ollama pull llama3.2`.
5. Set the following environment variables in the terminal or through a dedicated Windows service account. The worker does not automatically load `.env` files:

```text
COORDINATOR_URL=https://your-service.up.railway.app
WORKER_ACCESS_TOKEN=private-worker-key
WORKER_NAME=friend-windows-1
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2
```

6. Test one cycle with `npm run worker -- --once`.
7. For continuous operation, run `npm run worker` from the same dedicated account. If you use a launcher script, keep its environment file outside the repository and readable only by that account.

## Ubuntu VPS

Use an unprivileged dedicated account. Do not run the worker as root.

```bash
npm ci
ollama pull llama3.2
npm run worker -- --once
npm run worker
```

Create a systemd service only after the one-cycle test succeeds. Put secrets in an owner-readable environment file outside the repository and set its permissions to `0600`.

## Safety rules

- No inbound port is required.
- Never put the worker token in GitHub, screenshots, logs, or chat.
- Do not run the worker on a machine containing wallets or personal files.
- This MVP processes text prompts only and does not execute user code.
- Stop the worker immediately if the coordinator URL, TLS certificate, or expected operator changes unexpectedly.
