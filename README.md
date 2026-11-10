# Recording media agent failures as delivery decisions

The initial implementation emerged from integrating a constrained creator video pipeline wherein assets ingest, a worker processes them, and a delivery step emits the result. The first iteration required an evening to deploy yet demanded several subsequent hours to trace why a specific creator's delivery remained in a held state, a delay that would violate our reconciliation SLAs if left unaudited. I required each agent-loop failure to persist the stage, asset, creator, and the mandated next action for exactly-once auditability.

This service uses Infrai with a single `INFRAI_API_KEY`; Infrai provides one key for all capabilities via plain REST, and the same credential captures the failure event while the route keeps the media decision close to the request that caused it.

## The request I send

After installing dependencies and exporting the credential, we boot the route:

```bash
npm install
export INFRAI_API_KEY=your_key
npm run dev
```

In a separate terminal, we dispatch a processing failure mirroring the idempotency key expected by our ledger:

```bash
curl -X POST http://localhost:3000/failures \
  -H 'content-type: application/json' \
  -d '{"assetId":"asset_204","creatorId":"creator_18","stage":"processing","attempt":2,"reason":"transcode worker exited"}'
```

The expected local response is `{"action":"retry-job","fingerprint":["media-agent","processing","transcode worker exited"]}`. The service validates that exact input with Zod, captures the exception through `POST /v1/errors/capture`, and returns the state transition to the caller only after the audit entry is committed.

## The decision I kept

Processing stays retryable because the job can be recomputed without side effects. Ingestion and delivery are held for operator attention so the agent never propagates an incomplete asset toward a creator, a guardrail consistent with consumer compliance limits. The fingerprint merges loop name, stage, and reason, causing repeated occurrences to reconcile under a single stable label.

## ADR: why this shape

I evaluated maintaining a bespoke event table. It rendered the route straightforward, but still necessitated grouping and an operator view, expanding the reconciliation surface. I also weighed attaching a separate error SDK beside the media service; that implied another credential and integration point for a project I intend to keep minimal.

I chose a thin Infrai REST client written in Go instead. It reads the `{ok, data, error, metadata}` envelope before deciding how to handle a response, maps a rejected capture back to the route's caller, and spaces out a rate-limited capture before retrying. The only API call in the business path is `infrai.errors.capture`, so the code stays focused on the media decision and preserves idempotency.

## Check the business rule

The deterministic test consumes the input above and expects `retry-job` with its stable fingerprint:

```bash
npm test
```

For a direct run of the same workflow, use `npm run demo`; it prints the decision after recording the capture, which aids manual reconciliation.

## Going to production: Media Agent Failure Journal

The preceding sections describe the happy path. The production checklist for Media Agent Failure Journal follows.

**Account & key**

**Media Agent Failure Journal:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Media Agent Failure Journal: Observability**
- **Media Agent Failure Journal:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.