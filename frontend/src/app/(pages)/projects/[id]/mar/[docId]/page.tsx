"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { DocView } from "@/app/components/shared/DocView";
import type {
    MedMalDocumentEvent,
    MedMalMedicationEntry,
    MikeDocument,
    MikeProject,
} from "@/app/components/shared/types";
import {
    ApiError,
    getMedMalExtractionStatus,
    getProject,
    listMedMalDocumentEvents,
} from "@/app/lib/mikeApi";
import { Loader2 } from "lucide-react";

type BboxHighlight = { page: number; x: number; y: number; w: number; h: number };

// One UI row per medication entry, carrying the parent event's date + bbox so
// the row can sort chronologically and the click-to-scroll handler can highlight
// the citation region. Cell-level dates come from the medication entry's
// administered_at / ordered_at when present.
type MarRow = {
    key: string;
    eventId: string;
    eventDate: string | null;
    eventTime: string | null;
    sourcePage: number;
    bbox: MedMalDocumentEvent["source_bbox"];
    privacyClass: string;
    med: MedMalMedicationEntry;
    rowDate: string;
};

function buildMarRows(events: MedMalDocumentEvent[]): MarRow[] {
    const out: MarRow[] = [];
    for (const ev of events) {
        const meds = ev.medications ?? [];
        for (let i = 0; i < meds.length; i++) {
            const m = meds[i];
            const rowDate =
                m.administered_at ??
                m.ordered_at ??
                (ev.event_date ?? ev.event_date_text ?? "") +
                    (ev.event_time ? ` ${ev.event_time.slice(0, 5)}` : "");
            out.push({
                key: `${ev.id}#${i}`,
                eventId: ev.id,
                eventDate: ev.event_date,
                eventTime: ev.event_time ?? null,
                sourcePage: ev.source_page,
                bbox: ev.source_bbox,
                privacyClass: ev.privacy_class ?? "standard",
                med: m,
                rowDate,
            });
        }
    }
    return out;
}

function ProjectMarPage({
    projectId,
    docId,
}: {
    projectId: string;
    docId: string;
}) {
    const [project, setProject] = useState<MikeProject | null>(null);
    const [doc, setDoc] = useState<MikeDocument | null>(null);
    const [events, setEvents] = useState<MedMalDocumentEvent[]>([]);
    const [status, setStatus] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [bbox, setBbox] = useState<BboxHighlight | null>(null);
    const [selectedRow, setSelectedRow] = useState<string | null>(null);
    const [showMentalHealth, setShowMentalHealth] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const p = await getProject(projectId);
                if (cancelled) return;
                setProject(p);
                const matched =
                    (p.documents ?? []).find((d) => d.id === docId) ?? null;
                setDoc(matched);

                const st = await getMedMalExtractionStatus(docId);
                if (cancelled) return;
                setStatus(st.status);
                if (st.status !== "complete") return;

                const evResult = await listMedMalDocumentEvents(docId);
                if (cancelled) return;
                setEvents(evResult.events);
            } catch (e) {
                if (cancelled) return;
                if (e instanceof ApiError && e.status === 404) {
                    setError("No extraction yet for this document.");
                } else if (e instanceof ApiError && e.status === 403) {
                    setError("You don't have access to this document.");
                } else {
                    setError(e instanceof Error ? e.message : String(e));
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [projectId, docId]);

    const rows = useMemo(() => {
        const filtered = events.filter((e) => {
            const pc = e.privacy_class ?? "standard";
            if (pc === "mental_health_144_293" && !showMentalHealth) return false;
            return true;
        });
        const built = buildMarRows(filtered);
        return [...built].sort((a, b) => {
            if (a.rowDate !== b.rowDate) {
                if (!a.rowDate) return 1;
                if (!b.rowDate) return -1;
                return a.rowDate < b.rowDate ? -1 : 1;
            }
            return a.sourcePage - b.sourcePage;
        });
    }, [events, showMentalHealth]);

    function handleRowClick(row: MarRow) {
        const b = row.bbox;
        if (
            !b ||
            ![b.x, b.y, b.w, b.h].every(Number.isFinite) ||
            b.w <= 0 ||
            b.h <= 0
        ) {
            return;
        }
        setBbox({ page: row.sourcePage, x: b.x, y: b.y, w: b.w, h: b.h });
        setSelectedRow(row.key);
    }

    if (loading) {
        return (
            <div className="flex h-[50vh] items-center justify-center text-gray-500">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Loading MAR…
            </div>
        );
    }

    if (project && project.template_id !== "med-mal-case") {
        return (
            <div className="max-w-lg mx-auto py-16 px-4 text-center text-gray-600">
                <p className="mb-4">
                    The MAR view is available for{" "}
                    <strong>med-mal-case</strong> template projects.
                </p>
                <Link
                    href={`/projects/${projectId}`}
                    className="text-blue-700 underline"
                >
                    Back to project
                </Link>
            </div>
        );
    }

    if (!doc) {
        return (
            <div className="max-w-lg mx-auto py-16 px-4 text-center text-gray-600">
                <p className="mb-4">Document not found in this project.</p>
                <Link
                    href={`/projects/${projectId}`}
                    className="text-blue-700 underline"
                >
                    Back to project
                </Link>
            </div>
        );
    }

    if (status !== "complete") {
        return (
            <div className="max-w-lg mx-auto py-16 px-4 text-center text-gray-600">
                <p className="mb-4">
                    No completed extraction for{" "}
                    <strong>{doc.filename}</strong>
                    {status ? ` (status: ${status})` : ""}.
                </p>
                <Link
                    href={`/projects/${projectId}/extraction`}
                    className="text-blue-700 underline"
                >
                    Open the extraction view to run it
                </Link>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[calc(100vh-3.5rem)] min-h-0">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 shrink-0">
                <div>
                    <h1 className="text-sm font-semibold text-gray-900">
                        Medication administration (MAR)
                    </h1>
                    <p className="text-xs text-gray-500">
                        {project?.name} · {doc.filename} · {rows.length}{" "}
                        administrations
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <label className="text-xs text-gray-600 flex items-center gap-1.5">
                        <input
                            type="checkbox"
                            checked={showMentalHealth}
                            onChange={(e) => setShowMentalHealth(e.target.checked)}
                        />
                        Show § 144.293 records
                    </label>
                    <Link
                        href={`/projects/${projectId}`}
                        className="text-xs text-blue-700 hover:underline"
                    >
                        Back to project
                    </Link>
                </div>
            </div>
            <div className="flex flex-1 min-h-0">
                <div className="w-[42%] min-w-0 border-r border-gray-200 bg-gray-50">
                    <DocView
                        doc={{ document_id: docId }}
                        bboxHighlight={bbox}
                    />
                </div>
                <div className="flex-1 flex flex-col min-w-0">
                    {error && (
                        <div className="px-3 py-2 text-xs bg-red-50 text-red-700 border-b border-red-100 shrink-0">
                            {error}
                        </div>
                    )}
                    <div className="flex-1 overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-gray-50 text-gray-700 sticky top-0 z-10">
                                <tr className="border-b border-gray-200">
                                    <th className="text-left px-2 py-1.5 font-semibold">
                                        Timestamp
                                    </th>
                                    <th className="text-left px-2 py-1.5 font-semibold">
                                        Medication
                                    </th>
                                    <th className="text-left px-2 py-1.5 font-semibold">
                                        Dose
                                    </th>
                                    <th className="text-left px-2 py-1.5 font-semibold">
                                        Route
                                    </th>
                                    <th className="text-left px-2 py-1.5 font-semibold">
                                        Ordered by
                                    </th>
                                    <th className="text-left px-2 py-1.5 font-semibold">
                                        Administered by
                                    </th>
                                    <th className="text-left px-2 py-1.5 font-semibold">
                                        Indication
                                    </th>
                                    <th className="text-left px-2 py-1.5 font-semibold">
                                        Allergy?
                                    </th>
                                    <th className="text-left px-2 py-1.5 font-semibold">
                                        Wt-dose?
                                    </th>
                                    <th className="text-left px-2 py-1.5 font-semibold">
                                        Page
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => {
                                    const selected = selectedRow === r.key;
                                    const date = r.rowDate || "—";
                                    return (
                                        <tr
                                            key={r.key}
                                            onClick={() => handleRowClick(r)}
                                            className={`cursor-pointer border-b border-gray-100 hover:bg-gray-50 ${
                                                selected ? "bg-blue-50" : ""
                                            }`}
                                        >
                                            <td className="px-2 py-1.5 align-top whitespace-nowrap">
                                                {date}
                                            </td>
                                            <td className="px-2 py-1.5 align-top text-gray-900 font-medium">
                                                {r.med.name}
                                            </td>
                                            <td className="px-2 py-1.5 align-top">
                                                {r.med.dose ?? "—"}
                                            </td>
                                            <td className="px-2 py-1.5 align-top text-gray-600">
                                                {r.med.route ?? "—"}
                                            </td>
                                            <td className="px-2 py-1.5 align-top text-gray-600">
                                                {r.med.ordered_by ?? "—"}
                                            </td>
                                            <td className="px-2 py-1.5 align-top text-gray-600">
                                                {r.med.administered_by ?? "—"}
                                            </td>
                                            <td className="px-2 py-1.5 align-top text-gray-600">
                                                {r.med.indication ?? "—"}
                                            </td>
                                            <td className="px-2 py-1.5 align-top text-gray-600">
                                                {r.med.allergy_conflict_flag == null
                                                    ? "—"
                                                    : r.med.allergy_conflict_flag
                                                      ? "yes"
                                                      : "no"}
                                            </td>
                                            <td className="px-2 py-1.5 align-top text-gray-600">
                                                {r.med
                                                    .weight_based_dose_check_passed ==
                                                null
                                                    ? "—"
                                                    : r.med
                                                            .weight_based_dose_check_passed
                                                      ? "pass"
                                                      : "fail"}
                                            </td>
                                            <td className="px-2 py-1.5 align-top text-gray-500 whitespace-nowrap">
                                                p. {r.sourcePage}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {rows.length === 0 && (
                                    <tr>
                                        <td
                                            colSpan={10}
                                            className="px-2 py-6 text-center text-gray-400"
                                        >
                                            No medication administrations to display.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function Page({
    params,
}: {
    params: Promise<{ id: string; docId: string }>;
}) {
    const { id, docId } = use(params);
    return <ProjectMarPage projectId={id} docId={docId} />;
}
