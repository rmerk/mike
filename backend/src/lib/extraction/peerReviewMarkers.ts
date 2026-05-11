/**
 * Minn. Stat. § 145.64 peer-review markers — case-insensitive scan before extraction.
 * Phrases normalized from docs/PLAN_med_mal_extraction_pipeline.md (two sections merged).
 */
export const PEER_REVIEW_MARKERS = [
    "peer review",
    "peer-review committee",
    "QI committee",
    "quality improvement",
    "quality improvement review",
    "root cause analysis",
    "RCA report",
    "morbidity and mortality",
    "morbidity and mortality conference",
    "M&M conference",
    "sentinel event review",
] as const;

export function textContainsPeerReviewMarker(text: string): boolean {
    const lower = text.toLowerCase();
    return PEER_REVIEW_MARKERS.some((m) => lower.includes(m.toLowerCase()));
}
