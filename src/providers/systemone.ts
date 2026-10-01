import { Usd } from "../billing/money";
import type { Fetch } from "./openrouter/adapter";
import { nonNegativeInteger } from "./values";

/**
 * System One (https://docs.typesafe.ai/api) is TypeSafe's decision-model
 * API: `POST /v1/systemone` takes a state and typed questions and returns
 * `{ model, answers, usage }`. Other providers serve compatible models, so
 * `/proxy/v1/jev` picks a backend by the request's `model` and every backend
 * returns the same shape. A new provider is a new backend in its provider
 * module, listed in the jev route.
 */
export type SystemOneBackend = {
  /** `billing_reservations.provider` for requests this backend serves. */
  provider: string;
  /** Analytics labels are `<labelPrefix>/<model>`. */
  labelPrefix: string;
  /** The upstream model id for a requested model, or null when not served here. */
  resolve: (requested: string) => string | null;
  /** Every current backend charges per input token only. */
  inputPricePerMillion: (model: string) => Usd;
  /** Calls the provider; resolves to a response in System One shape. */
  send: (fetch: Fetch, model: string, body: string) => Promise<Response>;
  listModels: (fetch: Fetch, signal: AbortSignal) => Promise<SystemOneModel[]>;
};

/** An entry of `GET /v1/models`, in TypeSafe's shape. */
export type SystemOneModel = { name: string; description: string; release_date: string };

const TOKENS_PER_PRICE_UNIT = 1_000_000n;

/** `usage.input_tokens` / `usage.output_tokens` from a systemone response, or null when absent. */
export const systemOneTokens = (body: unknown): { inputTokens: number; outputTokens: number } | null => {
  if (body === null || typeof body !== "object") return null;
  const usage = (body as { usage?: unknown }).usage;
  if (usage === null || typeof usage !== "object") return null;
  const { input_tokens, output_tokens } = usage as { input_tokens?: unknown; output_tokens?: unknown };
  const inputTokens = nonNegativeInteger(input_tokens);
  if (inputTokens === null) return null;
  return { inputTokens, outputTokens: nonNegativeInteger(output_tokens) ?? 0 };
};

/** Input tokens priced at `pricePerMillion`; output tokens are free. Null without usage. */
export const systemOneCost = (body: unknown, pricePerMillion: Usd): Usd | null => {
  const tokens = systemOneTokens(body);
  if (!tokens) return null;
  return Usd.fromAtoms((pricePerMillion.toAtoms() * BigInt(tokens.inputTokens)) / TOKENS_PER_PRICE_UNIT);
};

/** The `model` a raw systemone response reports, or null. */
export const systemOneResponseModel = (raw: string): string | null => {
  try {
    const model = (JSON.parse(raw) as { model?: unknown })?.model;
    return typeof model === "string" && model ? model : null;
  } catch {
    return null;
  }
};
