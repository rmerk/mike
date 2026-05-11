import { describe, expect, it } from "vitest";
import {
    PEER_REVIEW_MARKERS,
    textContainsPeerReviewMarker,
} from "./peerReviewMarkers";

describe("peerReviewMarkers", () => {
    it("includes the canonical Minn. Stat. 145.64 markers", () => {
        expect(PEER_REVIEW_MARKERS).toContain("peer review");
        expect(PEER_REVIEW_MARKERS).toContain("M&M conference");
        expect(PEER_REVIEW_MARKERS).toContain("root cause analysis");
        expect(PEER_REVIEW_MARKERS).toContain("sentinel event review");
    });

    it("detects markers case-insensitively", () => {
        expect(textContainsPeerReviewMarker("Discussed at M&M conference")).toBe(
            true,
        );
        expect(textContainsPeerReviewMarker("routine follow-up")).toBe(false);
    });
});
