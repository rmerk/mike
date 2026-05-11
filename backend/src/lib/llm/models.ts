import type { Provider } from "./types";

// ---------------------------------------------------------------------------
// Canonical model IDs
// ---------------------------------------------------------------------------
// Main-chat tier (top-end) — user picks one of these per message.
export const CLAUDE_MAIN_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6"] as const;
export const GEMINI_MAIN_MODELS = [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
] as const;
export const OPENAI_MAIN_MODELS = ["gpt-5.5", "gpt-5.4-mini"] as const;

// Mid-tier (used for tabular review) — user picks one in account settings.
export const CLAUDE_MID_MODELS = ["claude-sonnet-4-6"] as const;
export const GEMINI_MID_MODELS = ["gemini-3-flash-preview"] as const;
export const OPENAI_MID_MODELS = ["gpt-5.4-mini"] as const;

// Low-tier (used for title generation, lightweight extractions) — user picks
// one in account settings.
export const CLAUDE_LOW_MODELS = ["claude-haiku-4-5"] as const;
export const GEMINI_LOW_MODELS = ["gemini-3.1-flash-lite-preview"] as const;
export const OPENAI_LOW_MODELS = ["gpt-5.4-nano"] as const;

// NVIDIA API Catalog (build.nvidia.com) — OpenAI-Chat-Completions-compatible
// endpoint at integrate.api.nvidia.com. Model IDs use a `vendor/name` shape,
// which is also how providerForModel distinguishes them from the others.
export const NVIDIA_MAIN_MODELS = [
    "moonshotai/kimi-k2.6",
    "meta/llama-3.3-70b-instruct",
    "deepseek-ai/deepseek-r1",
] as const;
export const NVIDIA_MID_MODELS = ["meta/llama-3.1-70b-instruct"] as const;
export const NVIDIA_LOW_MODELS = ["meta/llama-3.1-8b-instruct"] as const;

export const DEFAULT_MAIN_MODEL = "moonshotai/kimi-k2.6";
export const DEFAULT_TITLE_MODEL = "moonshotai/kimi-k2.6";
export const DEFAULT_TABULAR_MODEL = "moonshotai/kimi-k2.6";

const ALL_MODELS = new Set<string>([
    ...CLAUDE_MAIN_MODELS,
    ...GEMINI_MAIN_MODELS,
    ...OPENAI_MAIN_MODELS,
    ...CLAUDE_MID_MODELS,
    ...GEMINI_MID_MODELS,
    ...OPENAI_MID_MODELS,
    ...CLAUDE_LOW_MODELS,
    ...GEMINI_LOW_MODELS,
    ...OPENAI_LOW_MODELS,
    ...NVIDIA_MAIN_MODELS,
    ...NVIDIA_MID_MODELS,
    ...NVIDIA_LOW_MODELS,
]);

// ---------------------------------------------------------------------------
// Provider inference
// ---------------------------------------------------------------------------

export function providerForModel(model: string): Provider {
    if (model.startsWith("claude")) return "claude";
    if (model.startsWith("gemini")) return "gemini";
    if (model.startsWith("gpt-")) return "openai";
    // NVIDIA catalog IDs all contain a `vendor/name` slash; the other
    // providers' IDs never do.
    if (model.includes("/")) return "nvidia";
    throw new Error(`Unknown model id: ${model}`);
}

export function resolveModel(id: string | null | undefined, fallback: string): string {
    if (id && ALL_MODELS.has(id)) return id;
    return fallback;
}
