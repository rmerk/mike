import type {
    LlmMessage,
    NormalizedToolCall,
    NormalizedToolResult,
    OpenAIToolSchema,
    StreamChatParams,
    StreamChatResult,
} from "./types";

const NVIDIA_CHAT_URL =
    process.env.NVIDIA_BASE_URL?.replace(/\/$/, "") ||
    "https://integrate.api.nvidia.com/v1";
const MAX_OUTPUT_TOKENS = 16384;

type ChatRole = "system" | "user" | "assistant" | "tool";

type ChatToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
};

type ChatMessage =
    | { role: "system" | "user"; content: string }
    | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
    | { role: "tool"; tool_call_id: string; content: string };

type ChatToolDef = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
    };
};

type StreamToolCallDelta = {
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
};

type StreamChunk = {
    choices?: {
        delta?: {
            content?: string | null;
            tool_calls?: StreamToolCallDelta[];
        };
        finish_reason?: string | null;
        index?: number;
    }[];
};

function apiKey(override?: string | null): string {
    return override?.trim() || process.env.NVIDIA_API_KEY?.trim() || "";
}

function toChatTools(tools: OpenAIToolSchema[]): ChatToolDef[] {
    return tools.map((t) => ({
        type: "function",
        function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
        },
    }));
}

function buildInitialMessages(
    systemPrompt: string,
    history: LlmMessage[],
): ChatMessage[] {
    const out: ChatMessage[] = [];
    if (systemPrompt) out.push({ role: "system", content: systemPrompt });
    for (const m of history) {
        if (m.role === "assistant") {
            out.push({ role: "assistant", content: m.content });
        } else {
            out.push({ role: "user", content: m.content });
        }
    }
    return out;
}

function extractSseJson(buffer: string): { events: unknown[]; rest: string } {
    const events: unknown[] = [];
    const chunks = buffer.split(/\n\n/);
    const rest = chunks.pop() ?? "";

    for (const chunk of chunks) {
        const dataLines = chunk
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim());

        for (const data of dataLines) {
            if (!data || data === "[DONE]") continue;
            try {
                events.push(JSON.parse(data));
            } catch {
                // Incomplete event — wait for more bytes.
            }
        }
    }

    return { events, rest };
}

function parseToolCallArgs(raw: string): Record<string, unknown> {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // Some models stream malformed JSON; fall through to empty.
    }
    return {};
}

async function postChat(params: {
    model: string;
    messages: ChatMessage[];
    tools?: ChatToolDef[];
    stream: boolean;
    maxTokens?: number;
    apiKey: string;
}): Promise<Response> {
    const response = await fetch(`${NVIDIA_CHAT_URL}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${params.apiKey}`,
            "Content-Type": "application/json",
            Accept: params.stream ? "text/event-stream" : "application/json",
        },
        body: JSON.stringify({
            model: params.model,
            messages: params.messages,
            tools: params.tools?.length ? params.tools : undefined,
            stream: params.stream,
            max_tokens: params.maxTokens ?? MAX_OUTPUT_TOKENS,
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
            `NVIDIA request failed (${response.status}): ${text || response.statusText}`,
        );
    }

    return response;
}

export async function streamNvidia(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const {
        model,
        systemPrompt,
        tools = [],
        callbacks = {},
        runTools,
        apiKeys,
    } = params;
    const maxIter = params.maxIterations ?? 10;
    const key = apiKey(apiKeys?.nvidia);
    const chatTools = toChatTools(tools);
    const messages = buildInitialMessages(systemPrompt, params.messages);
    let fullText = "";
    const hasTools = chatTools.length > 0;

    for (let iter = 0; iter < maxIter; iter++) {
        const response = await postChat({
            model,
            messages,
            tools: chatTools,
            stream: true,
            apiKey: key,
        });
        if (!response.body) throw new Error("NVIDIA response had no body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let pendingText = "";

        // Tool calls stream in pieces keyed by `index`. We assemble each one
        // here and emit onToolCallStart the first time we see an id+name pair.
        const partialCalls = new Map<
            number,
            { id?: string; name?: string; args: string; started: boolean }
        >();
        const completedCalls: NormalizedToolCall[] = [];
        let finishedWithToolCalls = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const extracted = extractSseJson(buffer);
            buffer = extracted.rest;

            for (const event of extracted.events as StreamChunk[]) {
                const choice = event.choices?.[0];
                if (!choice) continue;

                const delta = choice.delta;
                if (delta?.content) {
                    if (hasTools) {
                        pendingText += delta.content;
                    } else {
                        fullText += delta.content;
                        callbacks.onContentDelta?.(delta.content);
                    }
                }

                if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const slot = partialCalls.get(tc.index) ?? {
                            id: undefined,
                            name: undefined,
                            args: "",
                            started: false,
                        };
                        if (tc.id) slot.id = tc.id;
                        if (tc.function?.name) slot.name = tc.function.name;
                        if (tc.function?.arguments) {
                            slot.args += tc.function.arguments;
                        }
                        partialCalls.set(tc.index, slot);

                        if (!slot.started && slot.id && slot.name) {
                            slot.started = true;
                            callbacks.onToolCallStart?.({
                                id: slot.id,
                                name: slot.name,
                                input: parseToolCallArgs(slot.args),
                            });
                        }
                    }
                }

                if (choice.finish_reason === "tool_calls") {
                    finishedWithToolCalls = true;
                }
            }
        }

        for (const slot of partialCalls.values()) {
            if (!slot.id || !slot.name) continue;
            completedCalls.push({
                id: slot.id,
                name: slot.name,
                input: parseToolCallArgs(slot.args),
            });
        }

        if (
            !finishedWithToolCalls ||
            !completedCalls.length ||
            !runTools
        ) {
            if (pendingText) {
                fullText += pendingText;
                callbacks.onContentDelta?.(pendingText);
            }
            break;
        }

        messages.push({
            role: "assistant",
            content: pendingText || null,
            tool_calls: completedCalls.map((c) => ({
                id: c.id,
                type: "function",
                function: {
                    name: c.name,
                    arguments: JSON.stringify(c.input),
                },
            })),
        });

        const results = await runTools(completedCalls);
        for (const r of results) {
            messages.push({
                role: "tool",
                tool_call_id: r.tool_use_id,
                content: r.content,
            });
        }
    }

    return { fullText };
}

export async function completeNvidiaText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: { nvidia?: string | null };
}): Promise<string> {
    const messages: ChatMessage[] = [];
    if (params.systemPrompt) {
        messages.push({ role: "system", content: params.systemPrompt });
    }
    messages.push({ role: "user", content: params.user });

    const response = await postChat({
        model: params.model,
        messages,
        stream: false,
        maxTokens: params.maxTokens ?? 512,
        apiKey: apiKey(params.apiKeys?.nvidia),
    });
    const json = (await response.json()) as {
        choices?: { message?: { content?: string | null } }[];
    };
    return json.choices?.[0]?.message?.content ?? "";
}

export type { NormalizedToolResult, ChatRole };
