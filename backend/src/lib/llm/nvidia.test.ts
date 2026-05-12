import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeNvidiaMedMalExtractionPage } from "./nvidia";

// Verifies the multimodal NVIDIA / Kimi extraction call assembles the
// OpenAI-compatible chat-completions payload correctly: structured `user`
// content array, base64-data-URL image_url, and the configured model.

describe("completeNvidiaMedMalExtractionPage", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        process.env.NVIDIA_API_KEY = "test-nvidia-key";
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it("sends image as data:image/png;base64 inside a user content array", async () => {
        const captured: { url?: string; body?: unknown } = {};
        globalThis.fetch = vi.fn(async (input, init) => {
            captured.url = typeof input === "string" ? input : String(input);
            captured.body = JSON.parse((init?.body as string) ?? "{}");
            return new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: { content: '{"events":[]}' },
                            finish_reason: "stop",
                        },
                    ],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }) as typeof fetch;

        const out = await completeNvidiaMedMalExtractionPage({
            model: "moonshotai/kimi-k2.6",
            systemPrompt: "extract events",
            userContent: "Page 1 width 612 height 792",
            visionPngBase64: "ZmFrZS1wbmctYnl0ZXM=",
        });

        expect(out).toBe('{"events":[]}');
        expect(captured.url).toContain("/v1/chat/completions");

        const body = captured.body as {
            model: string;
            messages: Array<{
                role: string;
                content: unknown;
            }>;
        };
        expect(body.model).toBe("moonshotai/kimi-k2.6");
        expect(body.messages).toHaveLength(2);
        expect(body.messages[0]).toEqual({
            role: "system",
            content: "extract events",
        });
        // User message must be a structured array, not a plain string.
        expect(Array.isArray(body.messages[1].content)).toBe(true);
        const userBlocks = body.messages[1].content as Array<{
            type: string;
            text?: string;
            image_url?: { url: string };
        }>;
        expect(userBlocks[0]).toEqual({
            type: "text",
            text: "Page 1 width 612 height 792",
        });
        expect(userBlocks[1].type).toBe("image_url");
        expect(userBlocks[1].image_url?.url).toBe(
            "data:image/png;base64,ZmFrZS1wbmctYnl0ZXM=",
        );
    });

    it("omits the image block entirely when visionPngBase64 is not provided", async () => {
        const captured: { body?: unknown } = {};
        globalThis.fetch = vi.fn(async (_input, init) => {
            captured.body = JSON.parse((init?.body as string) ?? "{}");
            return new Response(
                JSON.stringify({
                    choices: [{ message: { content: "ok" } }],
                }),
                { status: 200 },
            );
        }) as typeof fetch;

        await completeNvidiaMedMalExtractionPage({
            model: "moonshotai/kimi-k2.6",
            systemPrompt: "sys",
            userContent: "text only",
        });

        const body = captured.body as {
            messages: Array<{ content: Array<{ type: string }> }>;
        };
        const blocks = body.messages[1].content;
        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe("text");
    });

    it("surfaces non-2xx responses with status + body in the error message", async () => {
        globalThis.fetch = vi.fn(
            async () =>
                new Response("invalid api key", {
                    status: 401,
                    statusText: "Unauthorized",
                }),
        ) as typeof fetch;

        await expect(
            completeNvidiaMedMalExtractionPage({
                model: "moonshotai/kimi-k2.6",
                systemPrompt: "sys",
                userContent: "u",
                visionPngBase64: "AAAA",
            }),
        ).rejects.toThrow(/401.*invalid api key/);
    });

    it("retries on transient 5xx and succeeds when a later attempt returns 200", async () => {
        // 2 failures then a success — within the default 3-retry budget.
        let calls = 0;
        globalThis.fetch = vi.fn(async () => {
            calls++;
            if (calls < 3) {
                return new Response("upstream busy", {
                    status: 503,
                    statusText: "Service Unavailable",
                });
            }
            return new Response(
                JSON.stringify({
                    choices: [{ message: { content: '{"events":[]}' } }],
                }),
                { status: 200 },
            );
        }) as typeof fetch;

        // Stub sleep so the test doesn't actually wait for backoff. The
        // implementation uses setTimeout; vi.useFakeTimers + runAllTimers
        // doesn't compose well across await points, so we just keep the
        // backoffs short via env override.
        process.env.NVIDIA_MAX_RETRIES = "5";

        const out = await completeNvidiaMedMalExtractionPage({
            model: "moonshotai/kimi-k2.6",
            systemPrompt: "sys",
            userContent: "u",
        });

        expect(out).toBe('{"events":[]}');
        expect(calls).toBe(3);
    });

    it("does NOT retry on non-retryable 4xx (auth) errors", async () => {
        let calls = 0;
        globalThis.fetch = vi.fn(async () => {
            calls++;
            return new Response("bad key", { status: 401 });
        }) as typeof fetch;

        await expect(
            completeNvidiaMedMalExtractionPage({
                model: "moonshotai/kimi-k2.6",
                systemPrompt: "sys",
                userContent: "u",
            }),
        ).rejects.toThrow(/401/);
        // 401 must fail fast — retrying a bad credential just burns latency.
        expect(calls).toBe(1);
    });
});
