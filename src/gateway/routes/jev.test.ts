import { describe, expect, test } from "bun:test";

import { testDatabase } from "../../test/database";
import { jevRoutes } from "./jev";
import { billingRecords, createTestAccount, fakeFetch, onlyBillingRecord, post, testBilling } from "./test-harness";

const { sql } = await testDatabase();

describe("jev route", () => {
  const { billing, settlements, settled } = testBilling(sql);

  const routes = (fetch: ReturnType<typeof fakeFetch>["fetch"]) =>
    jevRoutes({
      sql,
      billing,
      settlements,
      enforceIdv: false,
      typesafeApiKey: "ts-key",
      cloudflareAccountId: "cf-account",
      cloudflareApiToken: "cf-token",
      fetch,
    });

  const call = async (label: string, upstream: () => Response, model?: string, extra: object = {}) => {
    const account = await createTestAccount(sql, `jev-${label}`);
    const fake = fakeFetch(upstream);
    const response = await routes(fake.fetch).handle(
      post("/proxy/v1/jev/systemone", { input: "hi", ...(model ? { model } : {}), ...extra }, {
        authorization: `Bearer ${account.apiKey}`,
      }),
    );
    const body = await response.text();
    await settled();
    return { account, response, body, upstream: fake.upstream, record: await onlyBillingRecord(sql, account.accountId) };
  };

  const QUESTIONS = { urgent: { type: "noul", instructions: "Is this urgent?" } };
  const CLEF_ANSWER = {
    model: "clef",
    answers: { urgent: { type: "noul", noul: 0.91 } },
    usage: { input_tokens: 1_000_000, output_tokens: 3 },
  };
  /** Workers AI wraps every reply in its v4 envelope. */
  const workersAi = (result: unknown, init: { status?: number; errors?: { code: number; message: string }[] } = {}) =>
    Response.json(
      { result, success: !init.errors, errors: init.errors ?? [], messages: [] },
      { status: init.status ?? 200 },
    );

  test("a successful response records the versioned model it reports", async () => {
    const { account, response, record } = await call("ok", () =>
      Response.json({ model: "jev-1.13.0", output: "hello", usage: { input_tokens: 1_000_000, output_tokens: 5 } }),
    );
    expect(response.status).toBe(200);
    expect(record.state).toBe("finalized");
    expect(record.actualCostUsd).toBe("0.042000000000");
    expect(record.event?.model).toBe("jev/jev-1.13.0");
    expect(record.event?.outcome).toBe("completed");
    expect(record.event?.user_id).toBe(account.userId);
    expect(record.event?.api_key_id).toBe(account.apiKeyId);
  });

  test("a provider error keeps the requested model label", async () => {
    const { response, record } = await call("error", () =>
      Response.json({ model: "jev-1.13.0", error: "unprocessable" }, { status: 422 }),
    );
    expect(response.status).toBe(422);
    expect(record.state).toBe("finalized");
    expect(record.event?.model).toBe("jev/jev-latest");
    expect(record.event?.outcome).toBe("provider_error");
  });

  test("a success without usable usage is charged the hold", async () => {
    const { response, record } = await call("no-usage", () => Response.json({ model: "jev-1.13.0", output: "hi" }));
    expect(response.status).toBe(200);
    expect([record.state, record.actualCostUsd, record.usageSource]).toEqual(["finalized", "0.020000000000", "fallback"]);
  });

  test("clef runs on Workers AI and is billed at Clef's price from its usage", async () => {
    const { response, body, upstream, record } = await call(
      "clef",
      () => workersAi(CLEF_ANSWER),
      "clef",
      { questions: QUESTIONS },
    );
    expect(response.status).toBe(200);
    // The caller gets the System One body, not the Workers AI envelope.
    expect(JSON.parse(body)).toEqual(CLEF_ANSWER);
    expect(upstream).toHaveLength(1);
    expect(upstream[0]!.url).toBe("https://api.cloudflare.com/client/v4/accounts/cf-account/ai/run/@cf/cloudflare/clef");
    expect(upstream[0]!.headers.get("authorization")).toBe("Bearer cf-token");
    expect(JSON.parse(upstream[0]!.body)).toEqual({ input: "hi", model: "clef", questions: QUESTIONS });
    expect([record.provider, record.state, record.actualCostUsd]).toEqual(["cloudflare", "finalized", "0.240000000000"]);
    expect(record.event?.model).toBe("cloudflare/clef");
    expect(record.event?.input_tokens).toBe(1_000_000);
    expect(JSON.parse(String(record.event?.response_body))).toEqual(CLEF_ANSWER);
  });

  test("a Workers AI validation error reaches the caller as a System One 422 with its message", async () => {
    const { response, body, record } = await call(
      "clef-invalid",
      () => workersAi(null, { status: 400, errors: [{ code: 5006, message: "questions.urgent: criteria too short" }] }),
      "clef",
    );
    expect(response.status).toBe(422);
    expect(JSON.parse(body)).toEqual({ error: "questions.urgent: criteria too short" });
    expect([record.provider, record.state]).toEqual(["cloudflare", "finalized"]);
    expect(record.event?.outcome).toBe("provider_error");
    expect(record.event?.http_status).toBe(422);
  });

  test("a model no provider serves is refused before anything is reserved", async () => {
    const account = await createTestAccount(sql, "jev-unknown");
    const fake = fakeFetch(() => Response.json({}));
    const response = await routes(fake.fetch).handle(
      post("/proxy/v1/jev/systemone", { model: "gpt-4o" }, { authorization: `Bearer ${account.apiKey}` }),
    );
    expect(response.status).toBe(400);
    expect(fake.upstream).toHaveLength(0);
    expect(await billingRecords(sql, account.accountId)).toEqual([]);
  });

  test("the model list merges TypeSafe's list with Clef from the Workers AI catalog", async () => {
    const account = await createTestAccount(sql, "jev-models");
    const catalog = [
      { name: "@cf/cloudflare/clef", description: "Clef is a 27B decision model.", created_at: "2026-09-29 14:05:24.552" },
      { name: "@cf/cloudflare/clef-flash", description: "Clef-flash is a fast 9B decision model.", created_at: "2026-09-29 09:25:44.258" },
      { name: "@cf/qwen/qwen3.8-27b", description: "Not a decision model.", created_at: "2026-01-01 00:00:00.000" },
    ];
    let typesafeUp = true;
    const fake = fakeFetch((url) => {
      if (url.includes("/ai/models/search")) return workersAi(catalog);
      return typesafeUp
        ? Response.json({ models: [{ name: "jev-latest", description: "Flagship", release_date: "2026-09-15" }] })
        : new Response("unavailable", { status: 503 });
    });
    const app = routes(fake.fetch);
    const list = async (path: string) => {
      const response = await app.handle(
        new Request(`http://gateway.test${path}`, { headers: { authorization: `Bearer ${account.apiKey}` } }),
      );
      expect(response.status).toBe(200);
      return ((await response.json()) as { models: { name: string; description: string; release_date: string }[] }).models;
    };

    for (const path of ["/proxy/v1/jev/models", "/proxy/v1/jev/v1/models"]) {
      expect(await list(path)).toEqual([
        { name: "jev-latest", description: "Flagship", release_date: "2026-09-15" },
        { name: "clef", description: "Clef is a 27B decision model.", release_date: "2026-09-29" },
        { name: "clef-flash", description: "Clef-flash is a fast 9B decision model.", release_date: "2026-09-29" },
      ]);
    }
    const catalogCall = fake.upstream.find((call) => call.url.includes("/ai/models/search"));
    expect(catalogCall?.headers.get("authorization")).toBe("Bearer cf-token");

    // One provider failing leaves the other's models listed.
    typesafeUp = false;
    expect((await list("/proxy/v1/jev/models")).map((model) => model.name)).toEqual(["clef", "clef-flash"]);
  });
});
