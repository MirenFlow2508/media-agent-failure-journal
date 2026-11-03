import test from "node:test";
import assert from "node:assert/strict";
import { decideFailure } from "../src/media_failure_route.ts";

test("processing failures retry the job under a stable media-stage fingerprint", () => {
  const decision = decideFailure({
    assetId: "asset_204",
    creatorId: "creator_18",
    stage: "processing",
    attempt: 2,
    reason: "transcode worker exited"
  });

  assert.deepEqual(decision, {
    action: "retry-job",
    fingerprint: ["media-agent", "processing", "transcode worker exited"]
  });
});
