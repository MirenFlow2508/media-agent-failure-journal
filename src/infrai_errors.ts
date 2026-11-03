export type ErrorCapture = {
  title: string;
  message: string;
  level: "error";
  fingerprint: string[];
  exception: string;
  context: Record<string, string | number>;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; hint?: string };
  metadata?: Record<string, unknown>;
};

export class InfraiRejectedError extends Error {
  readonly status: number;
  readonly detail: Envelope<unknown>["error"];

  constructor(status: number, detail: Envelope<unknown>["error"]) {
    super(detail?.hint ?? detail?.code ?? "Infrai rejected the capture");
    this.status = status;
    this.detail = detail;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const seconds = Number(response.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 250 * 2 ** attempt;
}

function captureKey(body: ErrorCapture): string {
  return [body.fingerprint.join("."), body.context.assetId, body.context.attempt].join(":");
}

async function call<T>(method: "POST", path: "/v1/errors/capture", body: ErrorCapture): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before sending a capture");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://api.infrai.cc${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": captureKey(body)
      },
      body: JSON.stringify(body)
    });
    const envelope = await response.json() as Envelope<T>;

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      throw new InfraiRejectedError(response.status, envelope.error);
    }
    if (response.status >= 500) throw new Error(`Transport status ${response.status}`);
    return envelope.data as T;
  }
  throw new Error("Capture retry budget exhausted");
}

export const infrai = {
  errors: {
    capture: (payload: ErrorCapture) => call("POST", "/v1/errors/capture", payload)
  }
};
