/**
 * Which maker's logo a model and an upstream are shown with — baocode's
 * ModelBrand (lib/models/model_brand.dart), ported as it is. The logos are
 * the files in `assets/model-icons/` (Iconify: Simple Icons CC0, theSVG MIT,
 * Remix Icon Apache-2.0; each file carries its own source line).
 */

/** a word of a model's name, after its start or a separator */
const word = (pattern: string) => new RegExp(`(^|[/_.: -])(?:${pattern})`, "i");

const MODELS: Array<[RegExp, string]> = [
  [word("claude|anthropic"), "claude"],
  [word("gemini"), "gemini"],
  [word("gemma"), "google"],
  [word("deepseek"), "deepseek"],
  [word("qwen|qwq|qvq"), "qwen"],
  [word("glm|chatglm|codegeex|cogview|zhipu"), "zhipu"],
  [word("kimi|moonshot"), "kimi"],
  [word("minimax|abab"), "minimax"],
  [word("doubao"), "doubao"],
  [word("seed"), "bytedance"],
  [word("hunyuan"), "hunyuan"],
  [word("ernie|wenxin"), "wenxin"],
  [word("step-"), "stepfun"],
  [word("baichuan"), "baichuan"],
  [word("yi-"), "yi"],
  [word("grok|xai"), "xai"],
  [word("mistral|mixtral|codestral|devstral|magistral|ministral|pixtral"), "mistral"],
  [word("llama"), "meta"],
  [word("phi-"), "microsoft"],
  [word("nemotron|nvidia"), "nvidia"],
  [word("sonar|perplexity"), "perplexity"],
  // last, as the most general: `o3` alone, or `o3-mini`
  [word("gpt|chatgpt|codex|openai|o\\d+(?:$|[-_.: ])"), "openai"],
];

const HOSTS: Array<[string[], string]> = [
  [["anthropic.com", "claude.ai"], "anthropic"],
  [["openai.com", "chatgpt.com"], "openai"],
  [["generativelanguage.googleapis.com"], "gemini"],
  [["aiplatform.googleapis.com"], "vertexai"],
  [["deepseek.com"], "deepseek"],
  [["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"], "qwen"],
  [["bigmodel.cn", "z.ai"], "zhipu"],
  [["moonshot.cn", "moonshot.ai", "kimi.com"], "moonshot"],
  [["minimax.io", "minimaxi.com", "minimax.chat"], "minimax"],
  [["volces.com", "volcengine.com"], "volcengine"],
  [["hunyuan.cloud.tencent.com", "hunyuan.tencentcloudapi.com"], "hunyuan"],
  [["qianfan.baidubce.com"], "wenxin"],
  [["stepfun.com"], "stepfun"],
  [["baichuan-ai.com"], "baichuan"],
  [["lingyiwanwu.com", "01.ai"], "yi"],
  [["x.ai"], "xai"],
  [["mistral.ai"], "mistral"],
  [["perplexity.ai"], "perplexity"],
  [["nvidia.com"], "nvidia"],
  [["githubcopilot.com"], "githubcopilot"],
  [["openrouter.ai"], "openrouter"],
  [["siliconflow.cn", "siliconflow.com"], "siliconflow"],
  [["together.xyz", "together.ai"], "together"],
  [["fireworks.ai"], "fireworks"],
  [["huggingface.co"], "huggingface"],
  [["ollama.com"], "ollama"],
  [["azure.com"], "azure"],
  [["amazonaws.com"], "bedrock"],
  [["cloudflare.com"], "cloudflare"],
  [["vercel.sh"], "vercel"],
];

/** pi's own provider ids, which have no base URL to read the maker from */
const PI_PROVIDERS: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  "openai-codex": "openai",
  "azure-openai-responses": "azure",
  "amazon-bedrock": "bedrock",
  google: "gemini",
  "google-vertex": "vertexai",
  "github-copilot": "githubcopilot",
  deepseek: "deepseek",
  mistral: "mistral",
  xai: "xai",
  groq: "meta",
  openrouter: "openrouter",
  huggingface: "huggingface",
  fireworks: "fireworks",
  "cloudflare-workers-ai": "cloudflare",
  "cloudflare-ai-gateway": "cloudflare",
  "kimi-coding": "kimi",
  moonshotai: "moonshot",
  "moonshotai-cn": "moonshot",
  minimax: "minimax",
  "minimax-cn": "minimax",
  nvidia: "nvidia",
  meta: "meta",
};

/** the maker of model `id`, as its name says; null when it does not */
export function brandOfModel(id: string): string | null {
  const name = id.toLowerCase();
  for (const [pattern, brand] of MODELS) if (pattern.test(name)) return brand;
  return null;
}

/** an upstream's maker, by where it is (its base URL) or by pi's provider id */
export function brandOfProvider(provider: string, baseUrl?: string): string | null {
  if (baseUrl) {
    try {
      const url = new URL(baseUrl.trim());
      const host = url.hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1") {
        if (url.port === "11434") return "ollama";
        if (url.port === "1234") return "lmstudio";
        if (url.port === "3425") return "magpie";
        return null;
      }
      for (const [domains, brand] of HOSTS) {
        if (domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return brand;
      }
    } catch {
      /* not a URL: fall through to the provider id */
    }
  }
  return PI_PROVIDERS[provider] ?? null;
}
