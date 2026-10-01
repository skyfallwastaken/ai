import { Elysia } from "elysia";

import { Usd } from "../../billing/money";
import { log } from "../../log";
import { cloudflareSystemOne } from "../../providers/cloudflare/provider";
import { meterJsonResponse } from "../../providers/json-provider";
import {
  type SystemOneBackend,
  systemOneCost,
  systemOneResponseModel,
  systemOneTokens,
} from "../../providers/systemone";
import { DEFAULT_JEV_MODEL, typesafeSystemOne } from "../../providers/typesafe/provider";
import { HttpError } from "../http-error";
import {
  authorizeProviderRequest,
  defaultRateLimiter,
  type MeteredRouteDependencies,
  parseJsonObject,
  type ProviderRouteInput,
  runProviderRoute,
} from "./shared";

export type JevRouteDependencies = MeteredRouteDependencies & {
  typesafeApiKey: string;
  cloudflareAccountId: string;
  cloudflareApiToken: string;
  /** Fixed hold per request; the actual charge comes from reported usage. */
  reservationUsd?: string;
  /**
   * Jev's price per million input tokens. TypeSafe reports token usage but no
   * cost, and its model listing carries no pricing, so this is the only
   * source. Output tokens are free (https://docs.typesafe.ai/models).
   */
  inputPricePerMillionTokensUsd?: string;
  baseUrl?: string;
  cloudflareBaseUrl?: string;
};

/**
 * System One decision models: TypeSafe's Jev and Cloudflare's Clef, picked by
 * the request's `model` (see providers/systemone.ts). `POST .../systemone` is
 * metered from the reported token usage; `GET .../models` lists every
 * backend's models. Both are served under `/proxy/v1/jev` and
 * `/proxy/v1/jev/v1`, the latter so TypeSafe's SDK works with its base URL
 * pointed at `/proxy/v1/jev`.
 */
export const jevRoutes = (deps: JevRouteDependencies) => {
  const rateLimiter = deps.rateLimiter ?? defaultRateLimiter();
  const reservation = Usd.parse(deps.reservationUsd ?? "0.02");
  const fetchImplementation = deps.fetch ?? fetch;
  const backends: SystemOneBackend[] = [
    typesafeSystemOne({
      apiKey: deps.typesafeApiKey,
      inputPricePerMillion: Usd.parse(deps.inputPricePerMillionTokensUsd ?? "0.042"),
      baseUrl: deps.baseUrl,
    }),
    cloudflareSystemOne({
      accountId: deps.cloudflareAccountId,
      apiToken: deps.cloudflareApiToken,
      baseUrl: deps.cloudflareBaseUrl,
    }),
  ];

  const resolve = (requested: string) => {
    for (const backend of backends) {
      const model = backend.resolve(requested);
      if (model) return { backend, model };
    }
    throw new HttpError(400, `Unknown model ${requested}. Available: jev-latest (and other Jev ids), clef, clef-flash.`);
  };

  const authorize = (request: Request, rawBody: string) =>
    authorizeProviderRequest(deps, rateLimiter, request, rawBody);

  const systemOne = async (request: Request) => {
    const rawBody = await request.text();
    const principal = await authorize(request, rawBody);

    const body = parseJsonObject(rawBody);
    const { backend, model } = resolve(
      typeof body.model === "string" && body.model ? body.model : DEFAULT_JEV_MODEL,
    );
    body.model = model;
    const requestBody = JSON.stringify(body);
    const price = backend.inputPricePerMillion(model);

    const input: ProviderRouteInput = {
      provider: backend.provider,
      endpoint: "jev/systemone",
      model: `${backend.labelPrefix}/${model}`,
      estimatedCostUsd: reservation,
      uncertainChargeUsd: reservation,
      execute: async () => {
        const upstream = await backend.send(fetchImplementation, model, requestBody);
        const metered = await meterJsonResponse(upstream, {
          init: { body: requestBody },
          extractCost: (response) => systemOneCost(response, price),
          extractTokens: systemOneTokens,
        });
        // A success is labelled with the model it reports (e.g. jev/jev-1.13.0).
        return {
          ...metered,
          completion: metered.completion.then((completion) => {
            const served = metered.response.ok ? systemOneResponseModel(completion.responseBody) : null;
            return served ? { ...completion, model: `${backend.labelPrefix}/${served}` } : completion;
          }),
        };
      },
    };

    const { metered } = await runProviderRoute(deps, request, principal, input);
    return metered.response;
  };

  /** Every backend's models; one whose listing fails is left out. */
  const models = async (request: Request) => {
    await authorize(request, "");
    const lists = await Promise.all(
      backends.map((backend) =>
        backend.listModels(fetchImplementation, request.signal).catch((error: unknown) => {
          log.warn({ err: error, provider: backend.provider }, "system one model listing failed");
          return [];
        }),
      ),
    );
    return Response.json({ models: lists.flat() });
  };

  return new Elysia({ prefix: "/proxy/v1/jev" })
    .post("/systemone", ({ request }) => systemOne(request))
    .get("/models", ({ request }) => models(request))
    .post("/v1/systemone", ({ request }) => systemOne(request))
    .get("/v1/models", ({ request }) => models(request));
};
