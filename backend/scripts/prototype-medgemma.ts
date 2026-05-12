// Prototype: pipe synthetic page text through MedGemma 27B-IT (LM Studio)
// using the same SYSTEM_PROMPT shape as medMalExtractor.ts. Goal is to see
// whether MedGemma produces well-formed events JSON before integrating.
//
// Run: LM Studio server on :1234 with `medgemma-27b-it` loaded, then:
//   npx tsx backend/scripts/prototype-medgemma.ts

const LMSTUDIO_URL = "http://localhost:1234/v1/chat/completions";
const MODEL = "medgemma-27b-it";

const SYSTEM_PROMPT = `You extract structured clinical timeline events from ONE page of a medical record PDF.
Return ONLY valid JSON (no markdown fences). Use this exact template shape, filling in real values or leaving fields as null when not present on the page — DO NOT emit the literal strings "string", "string|null", or any other placeholder text:
{"events":[{"event_date":null,"event_time":null,"event_date_text":null,"provider":null,"provider_role":null,"episode_of_care":null,"encounter_type":null,"privacy_class":"standard","key_date_role":null,"dx_codes":null,"medications":null,"vitals":null,"procedures":null,"narrative":null,"source_page":0,"source_bbox":{"x":0,"y":0,"w":0,"h":0}}]}

Field rules:
- source_page: integer equal to the page number given in the user message.
- source_bbox: tight rectangle around the cited region, PDF user space units (origin bottom-left).
- event_date: ISO "YYYY-MM-DD" or null. Never use other date formats.
- event_time: 24-hour "HH:MM" or null. Convert "0800" to "08:00".
- event_date_text: the literal date text from the page (e.g. "03/13/2024"), or null.
- encounter_type: one of "admission","ed","clinic","lab","imaging","op","nursing","note", or null.
- privacy_class: "standard" unless the note is clearly mental-health sensitive (then "mental_health_144_293").
- dx_codes: array of ICD-10 code strings, or null.
- procedures: array of procedure name strings, or null.
- medications: an ARRAY OF OBJECTS (or null), where each object is {"name":string,"dose":string|null,"route":string|null,"frequency":string|null,"notes":string|null}. Never a string. Never an array of strings.
- vitals: an ARRAY OF PER-TIMEPOINT OBJECTS (or null), where each object is {"time":"HH:MM"|null,"bp":"sys/dia"|null,"hr":number|null,"rr":number|null,"spo2":number|null,"temp_c":number|null,"pain":number|null}. Convert Temp F to Celsius.
- narrative: string ≤ 500 chars, or null.

Event granularity rules:
- For Medication Administration Records (MARs) or any table with one row per drug administration, emit ONE EVENT PER ROW: one event per (date, time, drug) tuple. Do not collapse multiple administrations into a single event.
- For nursing shift notes with multiple vital-sign timepoints, emit ONE EVENT covering the shift, with all timepoints in the vitals array.
- For lab panels, emit one event per panel (not per analyte).
- If the page has no clinically relevant discrete events, return {"events":[]}.`;

const SAMPLES: { name: string; pageNum: number; pageText: string }[] = [
    {
        name: "MAR row",
        pageNum: 14,
        pageText: `MEDICATION ADMINISTRATION RECORD
Patient: DOE, JANE    MRN: 00451223    DOB: 1962-04-11

Date        Time     Medication                   Dose       Route  Site/Notes        Initials
2024-03-12  06:00    Metoprolol Tartrate          25 mg      PO     swallowed         RM
2024-03-12  08:00    Lisinopril                   10 mg      PO     -                 RM
2024-03-12  08:00    Insulin Lispro               6 units    SC     L abdomen         RM
2024-03-12  12:00    Acetaminophen                650 mg     PO     pain 4/10         JK
2024-03-12  20:00    Enoxaparin                   40 mg      SC     R abdomen         JK
2024-03-12  22:00    Atorvastatin                 40 mg      PO     -                 JK

Allergies: PCN (rash)
Witness signatures on file.`,
    },
    {
        name: "Vitals + nursing note",
        pageNum: 22,
        pageText: `NURSING ASSESSMENT - SHIFT NOTE
Date: 03/13/2024     Shift: 0700-1900
Provider: Sarah Chen, RN

VITAL SIGNS
0800   BP 142/88   HR 96    RR 18   SpO2 94% RA    Temp 38.1 C
1200   BP 138/84   HR 92    RR 16   SpO2 96% RA    Temp 37.8 C
1600   BP 134/82   HR 88    RR 18   SpO2 97% RA    Temp 37.4 C

Pt c/o intermittent CP, denies SOB. EKG obtained, sinus rhythm, no acute ST changes.
Dr. Patel notified at 0830, ordered troponin q6h. Trop I at 0900: 0.08 (elevated).
Pt remains on telemetry. IV NS at 75 mL/hr. Voided 350 mL clear yellow.
Dx on chart: NSTEMI (I21.4), HTN (I10), Type 2 DM (E11.9).`,
    },
];

type ChatResponse = {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
};

function buildUserContent(pageNum: number, text: string): string {
    const pageW = 612;
    const pageH = 792;
    return `Page number: ${pageNum}\nPage width: ${pageW}\nPage height: ${pageH}\n\nPage text (may be incomplete if scanned):\n${text}`;
}

function stripJsonFences(raw: string): string {
    let s = raw.trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(s);
    if (fence) s = fence[1].trim();
    return s;
}

async function callMedGemma(userContent: string): Promise<{
    raw: string;
    elapsedMs: number;
    usage?: ChatResponse["usage"];
}> {
    const start = Date.now();
    const res = await fetch(LMSTUDIO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: MODEL,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userContent },
            ],
            temperature: 0.1,
            max_tokens: 2048,
        }),
    });
    if (!res.ok) {
        throw new Error(`LM Studio ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as ChatResponse;
    return {
        raw: json.choices[0]?.message?.content ?? "",
        elapsedMs: Date.now() - start,
        usage: json.usage,
    };
}

type ShapeReport = {
    medsShape: "array_of_objects" | "array_of_strings" | "string" | "null" | "other";
    vitalsShape: "array_of_objects" | "object" | "array_of_strings" | "null" | "other";
    dateIsoOk: boolean;
    timeHhmmOk: boolean;
};

function reportShape(ev: Record<string, unknown>): ShapeReport {
    let medsShape: ShapeReport["medsShape"] = "null";
    if (ev.medications === null || ev.medications === undefined) {
        medsShape = "null";
    } else if (Array.isArray(ev.medications)) {
        const arr = ev.medications;
        if (arr.length === 0) medsShape = "array_of_objects";
        else if (arr.every((m) => m && typeof m === "object")) medsShape = "array_of_objects";
        else if (arr.every((m) => typeof m === "string")) medsShape = "array_of_strings";
        else medsShape = "other";
    } else if (typeof ev.medications === "string") {
        medsShape = "string";
    } else {
        medsShape = "other";
    }

    let vitalsShape: ShapeReport["vitalsShape"] = "null";
    if (ev.vitals === null || ev.vitals === undefined) {
        vitalsShape = "null";
    } else if (Array.isArray(ev.vitals)) {
        const arr = ev.vitals;
        if (arr.length === 0) vitalsShape = "array_of_objects";
        else if (arr.every((v) => v && typeof v === "object")) vitalsShape = "array_of_objects";
        else if (arr.every((v) => typeof v === "string")) vitalsShape = "array_of_strings";
        else vitalsShape = "other";
    } else if (typeof ev.vitals === "object") {
        vitalsShape = "object";
    } else {
        vitalsShape = "other";
    }

    const dateOk =
        ev.event_date === null ||
        ev.event_date === undefined ||
        (typeof ev.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ev.event_date));
    const timeOk =
        ev.event_time === null ||
        ev.event_time === undefined ||
        (typeof ev.event_time === "string" && /^\d{2}:\d{2}$/.test(ev.event_time));

    return { medsShape, vitalsShape, dateIsoOk: dateOk, timeHhmmOk: timeOk };
}

function summarizeEvent(ev: Record<string, unknown>): string {
    const parts: string[] = [];
    if (ev.event_date) parts.push(`date=${ev.event_date}`);
    if (ev.event_time) parts.push(`time=${ev.event_time}`);
    if (ev.encounter_type) parts.push(`type=${ev.encounter_type}`);
    if (ev.provider) parts.push(`provider=${ev.provider}`);
    if (Array.isArray(ev.medications) && ev.medications.length) {
        parts.push(`meds=${ev.medications.length}`);
    }
    if (Array.isArray(ev.vitals) && ev.vitals.length) {
        parts.push(`vitals=${ev.vitals.length}`);
    } else if (ev.vitals && typeof ev.vitals === "object") {
        const keys = Object.keys(ev.vitals as object);
        parts.push(`vitals_obj=[${keys.join(",")}]`);
    }
    if (Array.isArray(ev.dx_codes) && ev.dx_codes.length) {
        parts.push(`dx=${(ev.dx_codes as unknown[]).join(",")}`);
    }
    return parts.join(" | ");
}

async function main() {
    for (const sample of SAMPLES) {
        console.log("\n" + "=".repeat(72));
        console.log(`SAMPLE: ${sample.name} (page ${sample.pageNum})`);
        console.log("=".repeat(72));

        const userContent = buildUserContent(sample.pageNum, sample.pageText);
        try {
            const { raw, elapsedMs, usage } = await callMedGemma(userContent);
            console.log(
                `latency=${elapsedMs}ms prompt_tok=${usage?.prompt_tokens} completion_tok=${usage?.completion_tokens}`,
            );
            console.log("\n--- RAW OUTPUT ---");
            console.log(raw);

            const stripped = stripJsonFences(raw);
            let parsed: unknown;
            try {
                parsed = JSON.parse(stripped);
            } catch (e) {
                console.log(
                    `\nXX JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
                );
                continue;
            }

            const events = (parsed as { events?: unknown[] }).events;
            if (!Array.isArray(events)) {
                console.log("\nXX no events array in output");
                continue;
            }
            console.log(`\n--- PARSED: ${events.length} event(s) ---`);
            for (const [i, ev] of events.entries()) {
                if (ev && typeof ev === "object") {
                    const o = ev as Record<string, unknown>;
                    const shape = reportShape(o);
                    console.log(
                        `  [${i}] ${summarizeEvent(o)} | meds_shape=${shape.medsShape} vitals_shape=${shape.vitalsShape} date_iso=${shape.dateIsoOk} time_hhmm=${shape.timeHhmmOk}`,
                    );
                }
            }

            const bboxOk = events.every(
                (ev) =>
                    ev &&
                    typeof ev === "object" &&
                    (ev as Record<string, unknown>).source_bbox &&
                    typeof (ev as Record<string, unknown>).source_bbox ===
                        "object",
            );
            const pageOk = events.every(
                (ev) =>
                    ev &&
                    typeof ev === "object" &&
                    (ev as Record<string, unknown>).source_page ===
                        sample.pageNum,
            );
            console.log(
                `\nschema checks: bbox_present=${bboxOk} source_page_correct=${pageOk}`,
            );
        } catch (e) {
            console.log(
                `\nXX request failed: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
