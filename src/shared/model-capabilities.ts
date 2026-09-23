/**
 * A best-effort read of what a model can do, from its name alone.
 *
 * The add-model dialog offers this as a starting point so nobody has to look up
 * a context window to try a model out — and it is deliberately the *only* place
 * it runs. Whatever lands in models.json is what the form held, so switching
 * the guess off leaves a purely manual form with nothing hidden behind it.
 *
 * Nothing is invented: an id that matches no family and carries no explicit
 * marker returns `null`, and a partial match (a bare `-1m` suffix) reports only
 * the field it actually knows. A wrong context window is worse than an empty
 * one — it silently truncates prompts.
 */
export interface ModelCapabilityGuess {
  contextWindow?: number;
  maxTokens?: number;
  supportsImages?: boolean;
  reasoning?: boolean;
}

export interface ModelCapabilityInput {
  /** the channel id from models.json — a tiebreaker when the model id is a nickname */
  provider?: string;
  /** the provider's own model id — the strongest signal */
  id: string;
  /** a display name, used when the id is a nickname */
  name?: string;
}

const K = 1000;
const M = 1_000_000;

interface Family {
  /** tested against the model id and display name first, then the channel id */
  match: RegExp;
  contextWindow?: number;
  maxTokens?: number;
  supportsImages?: boolean;
  reasoning?: boolean;
}

/**
 * Known families, most specific first — the first match wins, so an entry that
 * narrows (`gpt-4o`) must sit above the one that generalises (`gpt-4`).
 *
 * The numbers are the vendor-published defaults for the family: a context
 * window on the conservative side of the family's range and the documented
 * output ceiling where there is one. Vision follows the family, and `reasoning`
 * means "takes a thinking budget", not "is good at reasoning".
 */
const FAMILIES: Family[] = [
  /* Anthropic */
  { match: /claude|anthropic/, contextWindow: 200 * K, maxTokens: 64 * K, supportsImages: true, reasoning: true },
  /* OpenAI */
  { match: /gpt-5|gpt5/, contextWindow: 400 * K, maxTokens: 128 * K, supportsImages: true, reasoning: true },
  { match: /gpt-4\.1|gpt-4-1/, contextWindow: 1_000 * K, maxTokens: 32 * K, supportsImages: true },
  { match: /gpt-4o|gpt-4-turbo|gpt-4-vision/, contextWindow: 128 * K, maxTokens: 16 * K, supportsImages: true },
  { match: /(^|[^a-z])o[134](-|$)/, contextWindow: 200 * K, maxTokens: 100 * K, supportsImages: true, reasoning: true },
  { match: /gpt-oss/, contextWindow: 131 * K, maxTokens: 32 * K, reasoning: true },
  { match: /gpt-4|gpt-3\.5|gpt-3-5/, contextWindow: 128 * K, maxTokens: 8 * K },
  /* Google */
  { match: /gemini-1\.5-pro/, contextWindow: 2 * M, maxTokens: 8 * K, supportsImages: true, reasoning: true },
  { match: /gemini|google/, contextWindow: 1 * M, maxTokens: 64 * K, supportsImages: true, reasoning: true },
  /* DeepSeek */
  { match: /deepseek.*(r1|reasoner|thinking)/, contextWindow: 64 * K, maxTokens: 8 * K, reasoning: true },
  { match: /deepseek/, contextWindow: 128 * K, maxTokens: 8 * K },
  /* Moonshot / Kimi */
  { match: /(kimi|moonshot).*(thinking|k2)|k2-thinking/, contextWindow: 256 * K, maxTokens: 32 * K, reasoning: true },
  { match: /kimi|moonshot/, contextWindow: 128 * K, maxTokens: 32 * K },
  /* Zhipu */
  { match: /glm.*(thinking|reasoning)|glm-?4\.[5-9]|glm-?[5-9]/, contextWindow: 200 * K, maxTokens: 128 * K, reasoning: true },
  { match: /glm.*(vl|v\b)|glm-4v/, contextWindow: 128 * K, maxTokens: 8 * K, supportsImages: true },
  { match: /glm|zhipu|chatglm/, contextWindow: 128 * K, maxTokens: 8 * K },
  /* Alibaba */
  { match: /qwen.*(vl|vision)|qwen-?vl/, contextWindow: 128 * K, maxTokens: 32 * K, supportsImages: true },
  { match: /qwen/, contextWindow: 128 * K, maxTokens: 32 * K },
  /* xAI */
  { match: /grok-4|grok-3/, contextWindow: 256 * K, maxTokens: 32 * K, supportsImages: true, reasoning: true },
  { match: /grok/, contextWindow: 131 * K, maxTokens: 16 * K, supportsImages: true },
  /* MiniMax */
  { match: /minimax.*(m1|m2|thinking)/, contextWindow: 200 * K, maxTokens: 128 * K, reasoning: true },
  { match: /minimax|abab/, contextWindow: 200 * K, maxTokens: 128 * K },
  /* Mistral */
  { match: /mistral|magistral|codestral/, contextWindow: 128 * K, maxTokens: 32 * K },
  { match: /pixtral/, contextWindow: 128 * K, maxTokens: 32 * K, supportsImages: true },
  /* Meta */
  { match: /llama/, contextWindow: 128 * K, maxTokens: 16 * K },
  /* Cohere */
  { match: /command-r/, contextWindow: 128 * K, maxTokens: 8 * K },
  /* Amazon */
  { match: /nova/, contextWindow: 300 * K, maxTokens: 10 * K, supportsImages: true },
];

/** Context sizes a model id spells out for itself, largest first. */
const CONTEXT_MARKERS: Array<{ match: RegExp; value: number }> = [
  { match: /(^|[^0-9a-z])4m([^0-9a-z]|$)/, value: 4 * M },
  { match: /(^|[^0-9a-z])2m([^0-9a-z]|$)/, value: 2 * M },
  { match: /(^|[^0-9a-z])1m([^0-9a-z]|$)/, value: 1 * M },
  { match: /(^|[^0-9a-z])(512k|512000)([^0-9a-z]|$)/, value: 512 * K },
  { match: /(^|[^0-9a-z])(400k|400000)([^0-9a-z]|$)/, value: 400 * K },
  { match: /(^|[^0-9a-z])(256k|256000)([^0-9a-z]|$)/, value: 256 * K },
  { match: /(^|[^0-9a-z])(200k|200000)([^0-9a-z]|$)/, value: 200 * K },
  { match: /(^|[^0-9a-z])(128k|128000)([^0-9a-z]|$)/, value: 128 * K },
  { match: /(^|[^0-9a-z])(64k|64000)([^0-9a-z]|$)/, value: 64 * K },
  { match: /(^|[^0-9a-z])(32k|32000)([^0-9a-z]|$)/, value: 32 * K },
];

/**
 * Read what the id says about itself.
 *
 * The model id and display name are consulted first; only when neither names a
 * known family does the channel id get a turn, which is what catches a channel
 * called `deepseek` holding a model called `v3`.
 */
export function inferModelCapabilities(input: ModelCapabilityInput): ModelCapabilityGuess | null {
  const id = (input.id ?? "").trim().toLowerCase();
  const name = (input.name ?? "").trim().toLowerCase();
  const provider = (input.provider ?? "").trim().toLowerCase();
  const own = `${id} ${name}`.trim();
  if (!own && !provider) return null;

  const guess: ModelCapabilityGuess = {};

  /* The channel only gets a turn once there is an id to interpret: a form that
     has not been told which model it is describing has nothing to guess from,
     and filling 128K in from the word "deepseek" would be an invention. */
  const family =
    FAMILIES.find((entry) => entry.match.test(own)) ??
    (id ? FAMILIES.find((entry) => entry.match.test(provider)) : undefined);
  if (family) {
    guess.contextWindow = family.contextWindow;
    guess.maxTokens = family.maxTokens;
    if (family.supportsImages !== undefined) guess.supportsImages = family.supportsImages;
    if (family.reasoning !== undefined) guess.reasoning = family.reasoning;
  }

  /* Explicit markers beat the family: a `1m` in the id is the provider telling
     you the window, and it outranks whatever the family usually ships. */
  const marker = CONTEXT_MARKERS.find((entry) => entry.match.test(own));
  if (marker) guess.contextWindow = marker.value;

  /* `-vl`, `vision`, `multimodal`: a variant that reads images even when its
     family does not. */
  if (/(^|[^a-z])(vl|vision|multimodal)([^a-z]|$)/.test(own)) guess.supportsImages = true;

  /* `-thinking` / `-reasoner`: a thinking build of a model whose plain sibling
     is not one. */
  if (/(^|[^a-z])(thinking|reasoning|reasoner)([^a-z]|$)/.test(own)) guess.reasoning = true;

  return Object.keys(guess).length ? guess : null;
}
