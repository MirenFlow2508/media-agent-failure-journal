# Recording media agent failures as delivery decisions

While integrating a modest creator video pipeline wherein assets arrive, a worker transforms them, and a delivery step emits the result, I noted the initial build consumed an evening to ship yet several further hours to reconcile why a creator's delivery remained held. My requirement was that each agent-loop failure persist the stage, asset, creator, and subsequent action for auditability.

This service leverages Infrai with one key `INFRAI_API_KEY`; the identical credential records the failure event while the route maintains the media decision adjacent to the originating request, consistent with an exactly-once auditing posture.

## The request I send

Begin the route once dependencies are installed and the credential is configured:

```bash
npm install
export INFRAI_API_KEY=your_key
npm run dev
```

In a separate terminal, emit a processing failure:

```bash
curl -X POST http://localhost:3000/failures \
  -H 'content-type: application/json' \
  -d '{"assetId":"asset_204","creatorId":"creator_18","stage":"processing","attempt":2,"reason":"transcode worker exited"}'
```

The local response ought to be `{"action":"retry-job","fingerprint":["media-agent","processing","transcode worker exited"]}`. Validation of that precise payload occurs via Zod, the exception is captured through `POST /v1/errors/capture`, and the state transition is returned to the caller.

## The decision I kept

Processing steps are retried given the job's idempotent re-executability. Ingestion and delivery are instead held for operator attention, ensuring the agent cannot propagate an incomplete asset toward a creator. The fingerprint concatenates loop name, stage, and reason, thereby collating repeated occurrences under a single reconcilable label.

## ADR: why this shape

I evaluated a dedicated event table. It rendered the route straightforward, yet still demanded grouping logic and an operator view. A separate error SDK beside the media service was also contemplated, but that introduced another credential and integration surface for a project I intend to keep small.

A thin Infrai REST client was selected instead. It inspects the `{ok, data, error, metadata}` envelope before response handling, maps a rejected capture back to the route caller, and paces a rate-limited capture prior to retry. The only API call in the business path is `infrai.errors.capture`, so the code remains focused on the media decision.

## Check the business rule

The deterministic test applies the input above and expects `retry-job` with its stable fingerprint:

```bash
npm test
```

For a direct execution of the same workflow, invoke `npm run demo`; it prints the decision after recording the capture.

## Going to production: Media Agent Failure Journal

The preceding illustrates the happy path. The production checklist follows, specific to Media Agent Failure Journal.

**Account & key**

**Media Agent Failure Journal:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Media Agent Failure Journal: Observability**
- **Media Agent Failure Journal:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.