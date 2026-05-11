// Markers that signal peer-review / quality-improvement protected content
// under Minn. Stat. § 145.64. Extraction halts before any LLM call when any
// page contains one of these substrings (case-insensitive).
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
