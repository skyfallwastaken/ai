<script lang="ts">
  import ExternalIcon from "remixicon-svelte/icons/external-link-line";
  import CheckIcon from "remixicon-svelte/icons/check-line";
  import CloseIcon from "remixicon-svelte/icons/close-line";
  import CodeBlock from "#lib/components/code-block.svelte";
  import PageHeader from "#lib/components/page-header.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";

  let { data } = $props();

  let tab = $state<"curl" | "javascript" | "python">("curl");
  const tabs = [
    { key: "curl", label: "cURL" },
    { key: "javascript", label: "JavaScript" },
    { key: "python", label: "Python" },
  ] as const;

  const cell = "px-4 py-3 text-sm";

  const explainer = [
    { title: "Send a state", body: "The thing to judge: a support message, a JSON record, a chat log. Clef can also take images." },
    { title: "Ask questions", body: "Yes/no, pick-one, or rate-on-a-scale, each with the options you allow." },
    { title: "Get probabilities", body: "A typed answer per question with a probability for each option. Act when it's confident; hand off to a person when it isn't." },
  ];

  const models = $derived([
    { id: "jev-latest", by: "TypeSafe", notes: "Text only", price: data.inputPricePerMillionUsd },
    { id: "clef", by: "Cloudflare", notes: "Most accurate; also reads images", price: data.clefPrices.clef },
    { id: "clef-flash", by: "Cloudflare", notes: "Fastest; also reads images", price: data.clefPrices["clef-flash"] },
  ]);

  const questionTypes = [
    { type: "noul", asks: "Is this true?", criteria: "Optional", returns: "Probability of yes, 0 to 1" },
    { type: "choice", asks: "Which one?", criteria: "Option → description, up to 255. Add an \"other\".", returns: "Chosen option, each option's probability" },
    { type: "score", asks: "How much?", criteria: "2 to 10 levels, lowest first", returns: "Score (can land between levels), each level's probability" },
  ];

  const goodFor = ["Routing and triage", "Classifying and tagging", "Guardrails: is this safe to automate?", "Scoring severity, tone or quality"];
  const notFor = ["Writing text, chat or explanations", "Counting, arithmetic or comparing dates", "Decisions that need a written justification"];
</script>

<svelte:head><title>Jev</title></svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
  <PageHeader
    title="Jev"
    description="Decision models: send text and typed questions, get a probability for every answer"
  >
    {#snippet actions()}
      <span class="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">Beta</span>
      <Button href="https://docs.typesafe.ai/introduction" target="_blank" rel="noopener" variant="outline" size="sm">
        TypeSafe docs
        <ExternalIcon data-icon="inline-end" class="size-4" />
      </Button>
    {/snippet}
  </PageHeader>

  <section class="mt-10" aria-labelledby="how-heading">
    <h2 id="how-heading" class="mb-4 text-sm font-medium">How it works</h2>
    <ol role="list" class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {#each explainer as step, index (step.title)}
        <li class="bg-card rounded-lg border p-4">
          <p class="text-muted-foreground text-xs tabular-nums">{index + 1}</p>
          <p class="mt-1 text-sm font-medium">{step.title}</p>
          <p class="text-muted-foreground mt-1 text-sm text-pretty">{step.body}</p>
        </li>
      {/each}
    </ol>
    <p class="text-muted-foreground mt-3 text-sm text-pretty">
      Unlike a chat model, it never writes text, so there's nothing to parse and it can't answer outside your options. It answers every question at once, in milliseconds.
    </p>
  </section>

  <section class="mt-10" aria-labelledby="models-heading">
    <h2 id="models-heading" class="mb-4 text-sm font-medium">Models</h2>
    <div class="overflow-x-auto rounded-lg border">
      <table class="w-full border-collapse text-left">
        <thead class="text-muted-foreground border-b text-xs">
          <tr>
            <th class="{cell} font-medium">Model</th>
            <th class="{cell} font-medium">By</th>
            <th class="{cell} font-medium">Notes</th>
            <th class="{cell} text-right font-medium">Per 1M input tokens</th>
          </tr>
        </thead>
        <tbody>
          {#each models as model (model.id)}
            <tr class="border-b last:border-0">
              <td class="{cell} font-mono">{model.id}</td>
              <td class="{cell}">{model.by}</td>
              <td class="{cell} text-muted-foreground">{model.notes}</td>
              <td class="{cell} text-right tabular-nums">${model.price}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-muted-foreground mt-2 text-xs">Output is free. Usage counts against your daily allowance.</p>
  </section>

  <section class="mt-10" aria-labelledby="questions-heading">
    <h2 id="questions-heading" class="mb-4 text-sm font-medium">Question types</h2>
    <div class="overflow-x-auto rounded-lg border">
      <table class="w-full border-collapse text-left">
        <thead class="text-muted-foreground border-b text-xs">
          <tr>
            <th class="{cell} font-medium">Type</th>
            <th class="{cell} font-medium">Asks</th>
            <th class="{cell} font-medium">Criteria</th>
            <th class="{cell} font-medium">Returns</th>
          </tr>
        </thead>
        <tbody>
          {#each questionTypes as item (item.type)}
            <tr class="border-b last:border-0">
              <td class="{cell} font-mono">{item.type}</td>
              <td class="{cell}">{item.asks}</td>
              <td class="{cell} text-muted-foreground">{item.criteria}</td>
              <td class="{cell} text-muted-foreground">{item.returns}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section class="mt-10" aria-labelledby="fit-heading">
    <h2 id="fit-heading" class="sr-only">When to use it</h2>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div class="bg-card rounded-lg border p-4">
        <p class="mb-2 text-sm font-medium">Good for</p>
        <ul role="list" class="space-y-1.5 text-sm">
          {#each goodFor as item (item)}
            <li class="flex gap-2"><CheckIcon class="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" /><span>{item}</span></li>
          {/each}
        </ul>
      </div>
      <div class="bg-card rounded-lg border p-4">
        <p class="mb-2 text-sm font-medium">Not for</p>
        <ul role="list" class="space-y-1.5 text-sm">
          {#each notFor as item (item)}
            <li class="flex gap-2"><CloseIcon class="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" /><span>{item}</span></li>
          {/each}
        </ul>
      </div>
    </div>
  </section>

  <section class="mt-10" aria-labelledby="endpoint-heading">
    <h2 id="endpoint-heading" class="mb-4 text-sm font-medium">Endpoint</h2>
    <dl class="bg-card grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
      <div>
        <dt class="text-muted-foreground text-xs">Base URL</dt>
        <dd class="mt-1 font-mono text-sm break-all">{data.baseUrl}/proxy/v1/jev</dd>
      </div>
      <div>
        <dt class="text-muted-foreground text-xs">Routes</dt>
        <dd class="mt-1 font-mono text-sm">POST /systemone · GET /models</dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-muted-foreground text-xs">SDKs</dt>
        <dd class="mt-1 text-sm">TypeSafe's SDKs work with this base URL and your Hack Club AI key.</dd>
      </div>
    </dl>
  </section>

  <section class="mt-10" aria-labelledby="examples-heading">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 id="examples-heading" class="text-sm font-medium">Code examples</h2>
      <div class="bg-muted inline-flex gap-1 rounded-md p-1" role="tablist" aria-label="Language">
        {#each tabs as item (item.key)}
          <button
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onclick={() => (tab = item.key)}
            class="rounded-sm px-3 py-1 text-xs font-medium transition-colors {tab === item.key
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'}"
          >
            {item.label}
          </button>
        {/each}
      </div>
    </div>
    <CodeBlock code={data.examples[tab].code} html={data.examples[tab].html} />
  </section>

  <section class="mt-8" aria-labelledby="response-heading">
    <h2 id="response-heading" class="mb-4 text-sm font-medium">Example response</h2>
    <CodeBlock code={data.response.code} html={data.response.html} />
  </section>
</div>
