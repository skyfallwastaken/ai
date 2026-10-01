import { Usd } from "../../billing/money";
import type { ProviderModule } from "../provider";
import type { SystemOneBackend } from "../systemone";

export const CLOUDFLARE = "cloudflare";

/**
 * Cloudflare's Clef decision models on Workers AI. They take the System One
 * request body unchanged, and Cloudflare reports tokens but no cost, so the
 * listed per-input-token prices apply. Output is free.
 * https://developers.cloudflare.com/workers-ai/models/clef/
 * https://developers.cloudflare.com/workers-ai/models/clef-flash/
 */
export const CLEF_MODELS: Record<string, { id: string; inputPricePerMillionUsd: string }> = {
  clef: { id: "@cf/cloudflare/clef", inputPricePerMillionUsd: "0.24" },
  "clef-flash": { id: "@cf/cloudflare/clef-flash", inputPricePerMillionUsd: "0.09" },
};

/**
 * Workers AI rejects invalid input with 400 where System One uses 422. A 401
 * or 403 means the gateway's Cloudflare token was refused, which the caller
 * cannot fix, so it becomes a 502 rather than an authentication error.
 */
const ERROR_STATUS: Record<number, number> = { 400: 422, 401: 502, 403: 502 };

type Envelope = { success?: unknown; result?: unknown; errors?: unknown };

const errorMessage = (errors: unknown): string | null => {
  if (!Array.isArray(errors)) return null;
  const messages = errors
    .map((error) => (error as { message?: unknown } | null)?.message)
    .filter((message): message is string => typeof message === "string" && message !== "");
  return messages.length > 0 ? messages.join("; ") : null;
};

/**
 * Workers AI wraps every reply in its v4 envelope. A success becomes the bare
 * System One body; a failure becomes `{ error }`, the gateway's own error
 * shape, which TypeSafe's SDKs also read. A body that is not an envelope is
 * passed through as it came.
 */
const toSystemOne = async (upstream: Response): Promise<Response> => {
  const raw = await upstream.text();
  const headers = new Headers(upstream.headers);
  headers.delete("content-length");
  const reply = (body: string, status: number) =>
    new Response(body, { status, statusText: status === upstream.status ? upstream.statusText : "", headers });

  let envelope: Envelope;
  try {
    envelope = JSON.parse(raw) as Envelope;
  } catch {
    return reply(raw, upstream.status);
  }
  if (envelope === null || typeof envelope !== "object" || !("success" in envelope)) {
    return reply(raw, upstream.status);
  }
  if (upstream.ok && envelope.success === true && envelope.result != null) {
    return reply(JSON.stringify(envelope.result), upstream.status);
  }
  const status = upstream.ok ? 502 : (ERROR_STATUS[upstream.status] ?? upstream.status);
  const error = errorMessage(envelope.errors) ?? `Workers AI responded with HTTP ${upstream.status}`;
  return reply(JSON.stringify({ error }), status);
};

/** A Workers AI model catalog entry (`GET .../ai/models/search`). */
type CatalogModel = { name?: unknown; description?: unknown; created_at?: unknown };

export const cloudflareSystemOne = (options: {
  accountId: string;
  apiToken: string;
  baseUrl?: string;
}): SystemOneBackend => {
  const baseUrl = (options.baseUrl ?? "https://api.cloudflare.com/client/v4").replace(/\/$/, "");
  const accountUrl = `${baseUrl}/accounts/${options.accountId}/ai`;
  const authorization = `Bearer ${options.apiToken}`;
  return {
    provider: CLOUDFLARE,
    labelPrefix: CLOUDFLARE,
    // Workers AI accepts whitespace around `model`; match the same.
    resolve: (requested) => (Object.hasOwn(CLEF_MODELS, requested.trim()) ? requested.trim() : null),
    inputPricePerMillion: (model) => Usd.parse(CLEF_MODELS[model]!.inputPricePerMillionUsd),
    send: async (fetch, model, body) =>
      toSystemOne(
        await fetch(`${accountUrl}/run/${CLEF_MODELS[model]!.id}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization },
          body,
        }),
      ),
    // Workers AI has no System One model list; its general catalog carries
    // each model's description and release date.
    listModels: async (fetch, signal) => {
      const response = await fetch(`${accountUrl}/models/search?search=clef`, { headers: { authorization }, signal });
      if (!response.ok) throw new Error(`Workers AI model search returned HTTP ${response.status}`);
      const { result } = (await response.json()) as { result?: unknown };
      const catalog: CatalogModel[] = Array.isArray(result) ? result : [];
      return Object.entries(CLEF_MODELS).flatMap(([name, { id }]) => {
        const entry = catalog.find((model) => model?.name === id);
        if (!entry) return [];
        return [
          {
            name,
            description: typeof entry.description === "string" ? entry.description : "",
            release_date: typeof entry.created_at === "string" ? entry.created_at.slice(0, 10) : "",
          },
        ];
      });
    },
  };
};

/**
 * No lookup, as for TypeSafe: a success without usage is charged the hold,
 * and a pending hold is released after the max age without a charge.
 */
export const cloudflareProvider: ProviderModule = { key: CLOUDFLARE, reconcile: null };
