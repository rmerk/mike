import {
    streamClaude,
    completeClaudeText,
    completeClaudeMedMalExtractionPage,
} from "./claude";
import { streamGemini, completeGeminiText } from "./gemini";
import { streamOpenAI, completeOpenAIText } from "./openai";
import {
    streamNvidia,
    completeNvidiaText,
    completeNvidiaMedMalExtractionPage,
} from "./nvidia";
import { providerForModel } from "./models";
import type { StreamChatParams, StreamChatResult, UserApiKeys } from "./types";

export * from "./types";
export * from "./models";

export async function streamChatWithTools(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const provider = providerForModel(params.model);
    if (provider === "claude") return streamClaude(params);
    if (provider === "openai") return streamOpenAI(params);
    if (provider === "nvidia") return streamNvidia(params);
    return streamGemini(params);
}

export async function completeText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: UserApiKeys;
}): Promise<string> {
    const provider = providerForModel(params.model);
    if (provider === "claude") return completeClaudeText(params);
    if (provider === "openai") return completeOpenAIText(params);
    if (provider === "nvidia") return completeNvidiaText(params);
    return completeGeminiText(params);
}

export { completeClaudeMedMalExtractionPage } from "./claude";
export { completeNvidiaMedMalExtractionPage } from "./nvidia";

/**
 * Provider-dispatched single-page extraction. The med-mal extractor + the
 * § 145.64 peer-review vision prescan share this entry point so the
 * underlying vision-capable model can be swapped at runtime via
 * `MED_MAL_EXTRACTION_MODEL` without per-call branching.
 *
 * Supports providers whose API exposes image content blocks (claude, nvidia).
 * Other providers throw — the caller is responsible for validating the
 * configured model at boot via `resolveExtractionModel()`.
 */
export async function completeMedMalExtractionPage(params: {
    model: string;
    systemPrompt: string;
    userContent: string;
    visionPngBase64?: string;
    maxTokens?: number;
    apiKeys?: UserApiKeys;
}): Promise<string> {
    const provider = providerForModel(params.model);
    if (provider === "claude") {
        return completeClaudeMedMalExtractionPage({
            model: params.model,
            systemPrompt: params.systemPrompt,
            userContent: params.userContent,
            visionPngBase64: params.visionPngBase64,
            maxTokens: params.maxTokens,
            apiKeys: { claude: params.apiKeys?.claude ?? null },
        });
    }
    if (provider === "nvidia") {
        return completeNvidiaMedMalExtractionPage({
            model: params.model,
            systemPrompt: params.systemPrompt,
            userContent: params.userContent,
            visionPngBase64: params.visionPngBase64,
            maxTokens: params.maxTokens,
            apiKeys: { nvidia: params.apiKeys?.nvidia ?? null },
        });
    }
    throw new Error(
        `Provider "${provider}" does not have a med-mal extraction (vision) implementation. Use a Claude or NVIDIA (Kimi VLM) model.`,
    );
}
