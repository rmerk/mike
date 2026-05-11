import { describe, expect, it } from "vitest";
import {
    PEER_REVIEW_MARKERS,
    textContainsPeerReviewMarker,
} from "./peerReviewMarkers";

describe("peerReviewMarkers", () => {
    it("exports the expected marker count", () => {
        expect(PEER_REVIEW_MARKERS.length).toBe(11);
    });

    it("detects markers case-insensitively", () => {
        expect(textContainsPeerReviewMarker("Discussed at M&M conference")).toBe(
            true,
        );
        expect(textContainsPeerReviewMarker("routine follow-up")).toBe(false);
    });
});
