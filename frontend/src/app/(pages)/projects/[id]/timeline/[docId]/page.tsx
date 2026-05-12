"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { DocView } from "@/app/components/shared/DocView";
import type {
    MedMalDocumentEvent,
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

function ProjectTimelinePage({
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
                if (st.status !== "complete") {
                    return;
                }

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

    const sortedEvents = useMemo(() => {
        const filtered = events.filter((e) => {
            const pc = e.privacy_class ?? "standard";
            if (pc === "mental_health_144_293" && !showMentalHealth) return false;
            return true;
        });
        return [...filtered].sort((a, b) => {
            const ad = a.event_date ?? "";
            const bd = b.event_date ?? "";
            if (ad !== bd) {
                if (!ad) return 1;
                if (!bd) return -1;
                return ad < bd ? -1 : 1;
            }
            const at = a.event_time ?? "";
            const bt = b.event_time ?? "";
            if (at !== bt) {
                if (!at) return 1;
                if (!bt) return -1;
                return at < bt ? -1 : 1;
            }
            return a.source_page - b.source_page;
        });
    }, [events, showMentalHealth]);

    function handleRowClick(ev: MedMalDocumentEvent) {
        const b = ev.source_bbox;
        if (
            !b ||
            ![b.x, b.y, b.w, b.h].every(Number.isFinite) ||
            b.w <= 0 ||
            b.h <= 0
        ) {
            return;
        }
        setBbox({ page: ev.source_page, x: b.x, y: b.y, w: b.w, h: b.h });
        setSelectedRow(ev.id);
    }

    if (loading) {
        return (
            <div className="flex h-[50vh] items-center justify-center text-gray-500">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Loading timeline…
            </div>
        );
    }

    if (project && project.template_id !== "med-mal-case") {
        return (
            <div className="max-w-lg mx-auto py-16 px-4 text-center text-gray-600">
                <p className="mb-4">
                    The timeline view is available for{" "}
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
                        Medical chronology
                    </h1>
                    <p className="text-xs text-gray-500">
                        {project?.name} · {doc.filename} · {sortedEvents.length}{" "}
                        events
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
                                        Date
                                    </th>
                                    <th className="text-left px-2 py-1.5 font-semibold">
                                        Provider
                                    </th>
                                    <th className="text-left px-2 py-1.5 font-semibold">
                                        Role
                                    </th>
                                    <th className="text-left px-2 py-1.5 font-semibold">
                                        Encounter
                                    </th>
                                    <th className="text-left px-2 py-1.5 font-semibold">
                                        Episode
                                    </th>
                                    <th className="text-left px-2 py-1.5 font-semibold">
                                        Narrative
                                    </th>
                                    <th className="text-left px-2 py-1.5 font-semibold">
                                        Page
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedEvents.map((e) => {
                                    const date =
                                        e.event_date ?? e.event_date_text ?? "—";
                                    const time = e.event_time
                                        ? ` ${e.event_time.slice(0, 5)}`
                                        : "";
                                    const selected = selectedRow === e.id;
                                    return (
                                        <tr
                                            key={e.id}
                                            onClick={() => handleRowClick(e)}
                                            className={`cursor-pointer border-b border-gray-100 hover:bg-gray-50 ${
                                                selected ? "bg-blue-50" : ""
                                            }`}
                                        >
                                            <td className="px-2 py-1.5 align-top whitespace-nowrap">
                                                {date}
                                                {time}
                                            </td>
                                            <td className="px-2 py-1.5 align-top">
                                                {e.provider ?? "—"}
                                            </td>
                                            <td className="px-2 py-1.5 align-top text-gray-600">
                                                {e.provider_role ?? "—"}
                                            </td>
                                            <td className="px-2 py-1.5 align-top text-gray-600">
                                                {e.encounter_type ?? "—"}
                                            </td>
                                            <td className="px-2 py-1.5 align-top text-gray-600">
                                                {e.episode_of_care ?? "—"}
                                            </td>
                                            <td className="px-2 py-1.5 align-top text-gray-800">
                                                {e.narrative ?? "—"}
                                            </td>
                                            <td className="px-2 py-1.5 align-top text-gray-500 whitespace-nowrap">
                                                p. {e.source_page}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {sortedEvents.length === 0 && (
                                    <tr>
                                        <td
                                            colSpan={7}
                                            className="px-2 py-6 text-center text-gray-400"
                                        >
                                            No events to display.
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
    return <ProjectTimelinePage projectId={id} docId={docId} />;
}
