"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { DocView } from "@/app/components/shared/DocView";
import type {
    MedMalDocumentEvent,
    MedMalRedFlag,
    MikeDocument,
    MikeProject,
} from "@/app/components/shared/types";
import {
    getProject,
    getMedMalExtractionStatus,
    listMedMalDocumentEvents,
    listMedMalRedFlags,
    runMedMalExtraction,
} from "@/app/lib/mikeApi";
import { Loader2 } from "lucide-react";

function ProjectExtractionPage({ projectId }: { projectId: string }) {
    const [project, setProject] = useState<MikeProject | null>(null);
    const [loading, setLoading] = useState(true);
    const [docs, setDocs] = useState<MikeDocument[]>([]);
    const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
    const [events, setEvents] = useState<MedMalDocumentEvent[]>([]);
    const [flags, setFlags] = useState<MedMalRedFlag[]>([]);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    const [bbox, setBbox] = useState<{
        page: number;
        x: number;
        y: number;
        w: number;
        h: number;
    } | null>(null);
    const [runBusy, setRunBusy] = useState(false);
    const redFlagCycleRef = useRef<{ flagId: string; idx: number }>({
        flagId: "",
        idx: 0,
    });

    const refreshLists = useCallback(async (documentId: string) => {
        try {
            const [ev, rf] = await Promise.all([
                listMedMalDocumentEvents(documentId),
                listMedMalRedFlags(documentId),
            ]);
            setEvents(ev.events);
            setFlags(rf.red_flags);
        } catch {
            setEvents([]);
            setFlags([]);
        }
    }, []);

    useEffect(() => {
        getProject(projectId)
            .then((p) => {
                setProject(p);
                const d = (p.documents ?? []).filter((doc) =>
                    (doc.file_type ?? "").toLowerCase().includes("pdf"),
                );
                setDocs(d);
                setSelectedDocId((cur) => {
                    if (cur && d.some((x) => x.id === cur)) return cur;
                    return d[0]?.id ?? null;
                });
            })
            .finally(() => setLoading(false));
    }, [projectId]);

    useEffect(() => {
        redFlagCycleRef.current = { flagId: "", idx: 0 };
    }, [selectedDocId]);

    useEffect(() => {
        if (!selectedDocId) return;
        let cancelled = false;
        const tick = async () => {
            try {
                const st = await getMedMalExtractionStatus(selectedDocId);
                if (cancelled) return;
                setStatusMsg(
                    `${st.status} — pages ${st.pages_complete ?? 0}/${st.pages_total ?? "?"}${st.error ? ` (${st.error})` : ""}`,
                );
                if (st.status === "complete" || st.status === "failed") {
                    await refreshLists(selectedDocId);
                }
            } catch {
                if (!cancelled) setStatusMsg("No extraction yet — run extraction below.");
            }
        };
        void tick();
        const id = setInterval(tick, 4000);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [selectedDocId, refreshLists]);

    async function handleRun() {
        if (!selectedDocId) return;
        setRunBusy(true);
        setStatusMsg("Starting…");
        try {
            await runMedMalExtraction(selectedDocId);
            setStatusMsg("Running…");
        } catch (e) {
            setStatusMsg(e instanceof Error ? e.message : "Run failed");
        } finally {
            setRunBusy(false);
        }
    }

    if (loading) {
        return (
            <div className="flex h-[50vh] items-center justify-center text-gray-500">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Loading project…
            </div>
        );
    }

    if (project?.template_id !== "med-mal-case") {
        return (
            <div className="max-w-lg mx-auto py-16 px-4 text-center text-gray-600">
                <p className="mb-4">
                    Structured extraction is available for{" "}
                    <strong>med-mal-case</strong> template projects.
                </p>
                <Link href={`/projects/${projectId}`} className="text-blue-700 underline">
                    Back to project
                </Link>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[calc(100vh-3.5rem)] min-h-0">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 shrink-0">
                <div>
                    <h1 className="text-sm font-semibold text-gray-900">
                        Structured extraction
                    </h1>
                    <p className="text-xs text-gray-500">{project.name}</p>
                </div>
                <Link
                    href={`/projects/${projectId}`}
                    className="text-xs text-blue-700 hover:underline"
                >
                    Back to project
                </Link>
            </div>
            <div className="flex flex-1 min-h-0">
                <div className="w-[42%] min-w-0 border-r border-gray-200 flex flex-col">
                    <div className="p-2 border-b border-gray-100 flex flex-wrap gap-2 items-center">
                        <select
                            className="text-xs border border-gray-200 rounded px-2 py-1 max-w-full"
                            value={selectedDocId ?? ""}
                            onChange={(e) => {
                                setSelectedDocId(e.target.value || null);
                                setBbox(null);
                                redFlagCycleRef.current = { flagId: "", idx: 0 };
                            }}
                        >
                            {docs.map((d) => (
                                <option key={d.id} value={d.id}>
                                    {d.filename}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            disabled={!selectedDocId || runBusy}
                            onClick={() => void handleRun()}
                            className="text-xs rounded bg-black text-white px-3 py-1 disabled:opacity-40"
                        >
                            {runBusy ? "Starting…" : "Run extraction"}
                        </button>
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden bg-gray-50">
                        {selectedDocId ? (
                            <DocView
                                doc={{ document_id: selectedDocId }}
                                bboxHighlight={bbox}
                            />
                        ) : (
                            <p className="p-4 text-xs text-gray-500">No PDF documents.</p>
                        )}
                    </div>
                </div>
                <div className="flex-1 flex flex-col min-w-0">
                    <div className="text-xs text-gray-600 px-3 py-2 border-b border-gray-100 shrink-0">
                        {statusMsg}
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-4">
                        <section>
                            <h2 className="text-xs font-semibold text-gray-800 mb-2">
                                Red flags
                            </h2>
                            <ul className="space-y-2">
                                {flags.map((f) => (
                                    <li
                                        key={f.id}
                                        className="text-xs border border-amber-100 rounded p-2 bg-amber-50/50 cursor-pointer hover:bg-amber-50"
                                        onClick={() => {
                                            const withBbox = (
                                                f.supporting_event_ids ?? []
                                            )
                                                .map((id) =>
                                                    events.find((e) => e.id === id),
                                                )
                                                .filter(
                                                    (ev): ev is MedMalDocumentEvent =>
                                                        Boolean(ev),
                                                )
                                                .map((ev) => {
                                                    if (
                                                        !ev.source_bbox ||
                                                        typeof ev.source_bbox !==
                                                            "object"
                                                    )
                                                        return null;
                                                    const b = ev.source_bbox as {
                                                        x: number;
                                                        y: number;
                                                        w: number;
                                                        h: number;
                                                    };
                                                    if (
                                                        ![
                                                            b.x,
                                                            b.y,
                                                            b.w,
                                                            b.h,
                                                        ].every(Number.isFinite) ||
                                                        b.w <= 0 ||
                                                        b.h <= 0
                                                    )
                                                        return null;
                                                    return {
                                                        page: ev.source_page,
                                                        ...b,
                                                    };
                                                })
                                                .filter(
                                                    (
                                                        x,
                                                    ): x is NonNullable<
                                                        typeof x
                                                    > => x !== null,
                                                );
                                            if (withBbox.length === 0) return;
                                            const prev = redFlagCycleRef.current;
                                            const nextIdx =
                                                prev.flagId === f.id
                                                    ? (prev.idx + 1) %
                                                      withBbox.length
                                                    : 0;
                                            redFlagCycleRef.current = {
                                                flagId: f.id,
                                                idx: nextIdx,
                                            };
                                            setBbox(withBbox[nextIdx]!);
                                        }}
                                    >
                                        <span className="font-mono text-[10px] text-gray-500">
                                            {f.rule_id}
                                        </span>
                                        <div className="text-gray-800 mt-0.5">
                                            {f.summary}
                                        </div>
                                    </li>
                                ))}
                                {flags.length === 0 && (
                                    <li className="text-xs text-gray-400">None yet.</li>
                                )}
                            </ul>
                        </section>
                        <section>
                            <h2 className="text-xs font-semibold text-gray-800 mb-2">
                                Events
                            </h2>
                            <ul className="space-y-2">
                                {events.map((e) => (
                                    <li
                                        key={e.id}
                                        className="text-xs border border-gray-100 rounded p-2 hover:bg-gray-50 cursor-pointer"
                                        onClick={() => {
                                            const b = e.source_bbox as {
                                                x: number;
                                                y: number;
                                                w: number;
                                                h: number;
                                            };
                                            if (b && [b.x, b.y, b.w, b.h].every(Number.isFinite))
                                                setBbox({
                                                    page: e.source_page,
                                                    ...b,
                                                });
                                        }}
                                    >
                                        <span className="text-gray-500">
                                            p.{e.source_page}
                                        </span>{" "}
                                        {e.narrative ?? "—"}
                                    </li>
                                ))}
                                {events.length === 0 && (
                                    <li className="text-xs text-gray-400">
                                        No events — run extraction on a PDF.
                                    </li>
                                )}
                            </ul>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function Page({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = use(params);
    return <ProjectExtractionPage projectId={id} />;
}
