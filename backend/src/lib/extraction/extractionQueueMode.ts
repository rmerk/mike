export function extractionUsesDbQueue(): boolean {
    return process.env.EXTRACTION_ASYNC_MODE?.trim().toLowerCase() === "queue";
}
