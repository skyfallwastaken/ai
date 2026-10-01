import type { Usd } from "../../billing/money";
import type { ProviderModule } from "../provider";
import type { SystemOneBackend, SystemOneModel } from "../systemone";

export const TYPESAFE = "typesafe";

export const DEFAULT_JEV_MODEL = "jev-latest";
/**
 * The configured input price is Jev's. Any other model TypeSafe might serve
 * is priced differently, so only the Jev family is forwarded.
 */
export const JEV_MODEL = /^jev(-[a-z0-9.]+)?$/i;

/** TypeSafe's Jev. Requests and responses are already System One. */
export const typesafeSystemOne = (options: {
  apiKey: string;
  inputPricePerMillion: Usd;
  baseUrl?: string;
}): SystemOneBackend => {
  const baseUrl = (options.baseUrl ?? "https://api.typesafe.ai").replace(/\/$/, "");
  const authorization = `Bearer ${options.apiKey}`;
  return {
    provider: TYPESAFE,
    // `jev/jev-1.13.0`: a success is labelled with the versioned id it reports.
    labelPrefix: "jev",
    resolve: (requested) => (JEV_MODEL.test(requested) ? requested : null),
    inputPricePerMillion: () => options.inputPricePerMillion,
    send: (fetch, _model, body) =>
      fetch(`${baseUrl}/v1/systemone`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization },
        body,
      }),
    listModels: async (fetch, signal) => {
      const response = await fetch(`${baseUrl}/v1/models`, { headers: { authorization }, signal });
      if (!response.ok) throw new Error(`TypeSafe GET /v1/models returned HTTP ${response.status}`);
      const { models } = (await response.json()) as { models?: unknown };
      if (!Array.isArray(models)) throw new Error("TypeSafe GET /v1/models returned no models array");
      return models as SystemOneModel[];
    },
  };
};

/**
 * No lookup: the route charges the hold for a success without a readable
 * cost, and a pending Jev hold (a failed dispatch) is released after the
 * max age without a charge.
 */
export const typesafeProvider: ProviderModule = { key: TYPESAFE, reconcile: null };
