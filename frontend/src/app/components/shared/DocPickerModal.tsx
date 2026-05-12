"use client";

import type { MikeDocument } from "./types";

interface Props {
    docs: MikeDocument[];
    title: string;
    description: string;
    onPick: (doc: MikeDocument) => void;
    onCancel: () => void;
}

export function DocPickerModal({
    docs,
    title,
    description,
    onPick,
    onCancel,
}: Props): React.JSX.Element {
    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30"
            onClick={onCancel}
        >
            <div
                className="bg-white rounded-md shadow-lg w-full max-w-md p-4"
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className="text-sm font-semibold text-gray-900 mb-1">
                    {title}
                </h2>
                <p className="text-xs text-gray-500 mb-3">{description}</p>
                <ul className="max-h-72 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded">
                    {docs.map((d) => (
                        <li key={d.id}>
                            <button
                                type="button"
                                onClick={() => onPick(d)}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center justify-between gap-3"
                            >
                                <span className="truncate">{d.filename}</span>
                                <span className="text-gray-400 shrink-0">
                                    {d.page_count
                                        ? `${d.page_count} pp.`
                                        : ""}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
                <div className="mt-3 flex justify-end">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="text-xs text-gray-500 hover:text-gray-700"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
