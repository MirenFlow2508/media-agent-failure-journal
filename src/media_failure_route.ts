import { createServer } from "node:http";
import { z } from "zod";
import { InfraiRejectedError, infrai } from "./infrai_errors.ts";

const failureBody = z.object({
  assetId: z.string().min(1),
  creatorId: z.string().min(1),
  stage: z.enum(["ingestion", "processing", "delivery"]),
  attempt: z.number().int().positive(),
  reason: z.string().min(1)
});

export type MediaFailure = z.infer<typeof failureBody>;
export type FailureDecision = { action: "retry-job" | "hold-delivery"; fingerprint: string[] };

export function decideFailure(failure: MediaFailure): FailureDecision {
  const fingerprint = ["media-agent", failure.stage, failure.reason];
  return {
    fingerprint,
    action: failure.stage === "processing" ? "retry-job" : "hold-delivery"
  };
}

export async function recordMediaFailure(input: unknown): Promise<FailureDecision> {
  const failure = failureBody.parse(input);
  const decision = decideFailure(failure);
  await infrai.errors.capture({
    title: `Media ${failure.stage} needs attention`,
    message: failure.reason,
    level: "error",
    fingerprint: decision.fingerprint,
    exception: `${failure.stage}: ${failure.reason}`,
    context: {
      assetId: failure.assetId,
      creatorId: failure.creatorId,
      stage: failure.stage,
      attempt: failure.attempt
    }
  });
  return decision;
}

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) text += chunk;
  return JSON.parse(text);
}

async function handle(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) {
  if (request.method !== "POST" || request.url !== "/failures") {
    response.writeHead(404).end();
    return;
  }
  try {
    const decision = await recordMediaFailure(await readJson(request));
    response.writeHead(202, { "Content-Type": "application/json" }).end(JSON.stringify(decision));
  } catch (error) {
    if (error instanceof z.ZodError) {
      response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "invalid media failure" }));
      return;
    }
    if (error instanceof InfraiRejectedError) {
      response.writeHead(error.status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error.message }));
      return;
    }
    response.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "capture could not be recorded" }));
  }
}

const demo = process.argv.includes("--demo");
if (demo) {
  const sample: MediaFailure = { assetId: "asset_204", creatorId: "creator_18", stage: "processing", attempt: 2, reason: "transcode worker exited" };
  console.log(await recordMediaFailure(sample));
} else if (import.meta.url === `file://${process.argv[1]}`) {
  createServer(handle).listen(3000, () => console.log("media failure route listening on http://localhost:3000/failures"));
}
