import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractionRouter } from "./extraction";

vi.mock("../middleware/auth", () => ({
    requireAuth: (
        _req: unknown,
        res: express.Response,
        next: express.NextFunction,
    ) => {
        res.locals.userId = "user-b";
        res.locals.userEmail = "b@test.com";
        next();
    },
}));

const fromMock = vi.fn();
vi.mock("../lib/supabase", () => ({
    createServerSupabase: () => ({
        from: fromMock,
        rpc: vi.fn(),
    }),
}));

vi.mock("../lib/documentVersions", () => ({
    loadActiveVersion: vi.fn(async () => ({
        id: "ver-1",
        pdf_storage_path: "u/doc/file.pdf",
        storage_path: "u/doc/file.pdf",
    })),
}));

vi.mock("../lib/userSettings", () => ({
    getUserApiKeys: vi.fn(async () => ({})),
}));

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use("/extraction", extractionRouter);
    return app;
}

describe("extraction HTTP access", () => {
    beforeEach(() => {
        fromMock.mockReset();
    });

    it("returns 404 when document is missing (status)", async () => {
        fromMock.mockImplementation((table: string) => {
            if (table === "documents") {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => ({
                                data: null,
                                error: null,
                            }),
                        }),
                    }),
                };
            }
            throw new Error(`unexpected table ${table}`);
        });
        const res = await request(buildApp())
            .get("/extraction/doc-missing/status")
            .set("Authorization", "Bearer test-token");
        expect(res.status).toBe(404);
    });

    it("returns 403 when user cannot access document (status)", async () => {
        fromMock.mockImplementation((table: string) => {
            if (table === "documents") {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => ({
                                data: {
                                    id: "doc-1",
                                    user_id: "user-a",
                                    project_id: null,
                                    file_type: "application/pdf",
                                    filename: "a.pdf",
                                },
                                error: null,
                            }),
                        }),
                    }),
                };
            }
            throw new Error(`unexpected table ${table}`);
        });
        const res = await request(buildApp())
            .get("/extraction/doc-1/status")
            .set("Authorization", "Bearer test-token");
        expect(res.status).toBe(403);
    });

    it("returns 403 when user cannot access document (events)", async () => {
        fromMock.mockImplementation((table: string) => {
            if (table === "documents") {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => ({
                                data: {
                                    id: "doc-1",
                                    user_id: "user-a",
                                    project_id: null,
                                    file_type: "application/pdf",
                                    filename: "a.pdf",
                                },
                                error: null,
                            }),
                        }),
                    }),
                };
            }
            throw new Error(`unexpected table ${table}`);
        });
        const res = await request(buildApp())
            .get("/extraction/doc-1/events")
            .set("Authorization", "Bearer test-token");
        expect(res.status).toBe(403);
    });

    it("returns 409 when extraction insert hits running unique constraint", async () => {
        fromMock.mockImplementation((table: string) => {
            if (table === "documents") {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => ({
                                data: {
                                    id: "doc-1",
                                    user_id: "user-b",
                                    project_id: "proj-1",
                                    file_type: "application/pdf",
                                    filename: "a.pdf",
                                },
                                error: null,
                            }),
                        }),
                    }),
                };
            }
            if (table === "projects") {
                return {
                    select: () => ({
                        eq: () => ({
                            maybeSingle: async () => ({
                                data: { template_id: "med-mal-case" },
                                error: null,
                            }),
                        }),
                    }),
                };
            }
            if (table === "document_extractions") {
                return {
                    insert: () => ({
                        select: () => ({
                            single: async () => ({
                                data: null,
                                error: {
                                    code: "23505",
                                    message: "duplicate key",
                                },
                            }),
                        }),
                    }),
                };
            }
            throw new Error(`unexpected table ${table}`);
        });
        const res = await request(buildApp())
            .post("/extraction/doc-1/run")
            .set("Authorization", "Bearer test-token");
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("extraction_conflict");
    });
});
