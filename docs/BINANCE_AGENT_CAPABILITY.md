# Binance Agent capability design

Status: research specification only. No trading capability is enabled in the beta.

## Official building blocks

Binance documents three relevant agent-facing components:

1. Agentic MCP Server exposes Binance functionality to MCP-compatible agents.
2. Skills Hub packages reusable Binance skills for agent runtimes.
3. Agentic Wallet is the wallet-oriented layer for agent applications.

These components can help an operator run a Binance-aware agent, but they do not change the network trust boundary: requesters must never receive the operator's Binance API key, wallet key, session, or account identity.

## Network model

A Binance-capable agent runs locally on the worker operator's PC or VPS. It connects to Worker Relay through outbound HTTPS, advertises only explicit capabilities, evaluates jobs locally, and talks to Binance directly. The coordinator stores job state but never stores or forwards Binance credentials.

Requester and operator remain separate roles. A requester can submit a permitted financial-information job without running a worker. An operator can contribute a Binance-aware agent without sharing their account with the requester.

## Proposed phased capabilities

### Phase 1 — public market data

`finance.binance.market-data`

- Public prices, order books, klines, symbols, exchange filters and market status.
- No account credential required.
- Read-only and suitable for the first implementation.
- Output must identify source timestamps and stale-data conditions.

### Phase 2 — private account inspection

`finance.binance.account.read`

- Balances, open orders, order history and fills.
- Uses an operator-local, read-only API credential.
- Output is private by default and must redact account identifiers.
- Public Explorer publication is blocked for this capability.

### Phase 3 — trade proposal, no execution

`finance.binance.trade.proposal`

- Produces a structured proposed order from approved market/account inputs.
- Never submits the order.
- Includes symbol, side, type, quantity, estimated notional, filters, risks and expiry.
- Intended for human review before any separate execution action.

### Future phase — human-approved execution

`finance.binance.spot.execute`

This capability must remain disabled until all controls below exist and have been independently reviewed.

## Required permission manifest

Every finance worker must load a local fail-closed manifest, separate from `.env`:

```json
{
  "mode": "read-only",
  "allowedSymbols": ["BTCUSDT", "ETHUSDT"],
  "maxOrderNotionalUsd": 0,
  "maxDailyNotionalUsd": 0,
  "allowedOrderTypes": [],
  "allowWithdrawals": false,
  "requireHumanApproval": true,
  "approvalTtlSeconds": 120
}
```

The worker must reject a job when a field is missing, an action exceeds the manifest, the symbol is not allowlisted, the approval expired, or the current account state cannot be verified.

## Execution controls required before trading

- Dedicated Binance credential with the minimum permissions supported by the account.
- No withdrawal permission under any circumstance.
- IP restriction when Binance supports it for the credential.
- Credentials stored only on the operator machine.
- Structured orders only; no arbitrary shell, JavaScript, Python, URL, endpoint or MCP command supplied by a requester.
- Server-generated execution intent ID and a second, explicit human approval bound to the exact order hash.
- Re-fetch current price, exchange filters and balances immediately before execution.
- Maximum notional per order and per day.
- Symbol and order-type allowlists.
- Idempotency and duplicate-order protection.
- Append-only audit events for proposal, approval, rejection, submission, exchange response and reconciliation.
- Emergency local kill switch and coordinator-side capability disable.
- Private-by-default jobs; account and trading outputs cannot be published to the public Explorer.
- Automatic redaction of API keys, signatures, account IDs, wallet addresses when private, client order IDs and raw headers.

## Safe first implementation

The first deliverable should implement only `finance.binance.market-data` against Binance public Spot market-data endpoints. The adapter should use a fixed operation enum such as `ticker`, `orderbook`, `klines`, and `exchangeInfo`, validate every parameter, enforce response-size limits, and return normalized JSON. It should not accept arbitrary endpoint names or raw MCP tool calls.

After that adapter is tested in production, `finance.binance.account.read` can be considered as a separate opt-in capability. Trading remains a later, separately reviewed project.

## Non-goals for the beta

- No autonomous trading.
- No requester-supplied Binance keys.
- No shared Binance account.
- No withdrawals or transfers.
- No wallets, token payments, NFTs or platform contracts.
- No claims that a Binance agent is active until a real worker advertises a verified capability.
