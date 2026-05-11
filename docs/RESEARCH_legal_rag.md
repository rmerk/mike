# Legal RAG: state of the art (2024–2026)

A research synthesis for engineers building legal AI tools. Companion to
[PLAN_med_mal_extraction_pipeline.md](./PLAN_med_mal_extraction_pipeline.md), which
turns the Mike-specific recommendation below into a concrete build plan.

## Headline

Legal RAG is not a single problem. The right architecture for case-law research
looks almost nothing like the right architecture for a 3,000-page Epic medical
record. Choosing the wrong shape — vector store where you needed structured
extraction, or vice versa — burns engineering quarters with little to show.

This doc maps four distinct lanes, plus three cross-cutting questions
(long-context vs RAG, hybrid retrieval, GraphRAG), and ends with a pointer to the
Mike-specific build plan.

The four lanes:

1. **Case-law / statute research** — Westlaw/Lexis-style; citation accuracy is
   non-negotiable.
2. **Contract & transactional review** — clause extraction, redlining, playbook
   comparison; structured-extraction-over-one-doc shape.
3. **E-discovery / document review at scale** — millions of docs, privilege +
   responsiveness; hybrid TAR + LLM.
4. **Medical-records review for medical malpractice** — 3,000+ page Epic PDFs,
   structured event log + page+bbox citations.

---

## Lane 1 — Case-law / statute research

Citation accuracy is the load-bearing constraint. Hallucinated cites are
career-ending; production systems exist specifically to bound that risk, and even
the best of them fail at non-trivial rates.

The empirical baseline comes from Stanford RegLab (Magesh, Surani, Manning, Ho —
*Journal of Empirical Legal Studies*, 2025), which tested Lexis+ AI, Westlaw
AI-Assisted Research, and Ask Practical Law against 200+ pre-registered queries.
**Lexis+ AI hallucinated ~17% of the time; Westlaw's tool ~33%; Practical Law
refused >60% of queries.** Concrete examples include Westlaw fabricating a Federal
Rule of Bankruptcy Procedure and Lexis+ citing the overruled *Casey* "undue
burden" standard *after Dobbs* came down. All three are RAG products. RAG by
itself does not solve legal hallucination
([Stanford RegLab paper](https://reglab.stanford.edu/publications/hallucination-free-assessing-the-reliability-of-leading-ai-legal-research-tools/),
[HAI summary](https://hai.stanford.edu/news/ai-trial-legal-models-hallucinate-1-out-6-or-more-benchmarking-queries)).

What actually ships:

- **CoCounsel** (Casetext, now Thomson Reuters) — RAG layered over the proprietary
  Westlaw corpus. Retrieves real cases, then summarizes. Strength = closed
  authoritative universe. Weakness = no firm-specific customization.
- **Harvey** — explicitly says vanilla RAG was insufficient. Stack: legal-specific
  preprocessing → hybrid search → custom fine-tuned embeddings → multi-stage
  reasoning → legal answer post-processing, plus a content alliance with
  LexisNexis ("Ask LexisNexis") for citation grounding including Shepard's
  ([LawNext on Harvey vs. CoCounsel](https://www.lawnext.com/2024/05/harvey-ai-to-move-out-of-early-access-phase-release-more-affordable-versions-of-its-custom-ai-models.html)).
  Treats case-law search as an *agent task*, not a single retrieval call.
- **L-MARS** ([arXiv:2509.00761](https://arxiv.org/html/2509.00761v2), Sept 2025)
  is the cleanest open description: a multi-agent workflow with a Search Agent
  (Serper + local RAG + CourtListener API), a Judge Agent that runs an explicit
  sufficiency checklist (factual support, jurisdiction match, temporal
  specificity, contradiction analysis), and a Summary Agent that emits citations.
  Outperforms vanilla GPT/Claude/Gemini on factual accuracy.

Architecture favored: hybrid BM25 + dense + cross-encoder reranker, inside an
*iterative agent loop* (not single-shot retrieval), with a strict "no source, no
answer" gate. The judge step is the difference between systems that hallucinate
17% of the time and systems that refuse rather than fabricate.

Chunking: statute-aware (preserve § numbers, subsections, definitions blocks),
case-aware (preserve headnotes, holding, procedural posture). Recursive
structure-aware splitters consistently beat fixed-size on
[LegalBench-RAG](https://arxiv.org/abs/2408.10343) (Aug 2024) — 6,858 query/answer
pairs over 79M chars, requiring retrieval of *minimal* spans, not document IDs.
See also the Bar Exam QA and Housing Statute QA datasets from 2025
([ACM Symposium on Computer Science and Law](https://dl.acm.org/doi/10.1145/3709025.3712219)).

Failure modes: fabricated cite-checkers, citing overruled authority,
jurisdictional confusion, false-premise queries that produce confident wrong
answers instead of refusal.

---

## Lane 2 — Contract & transactional review

Less "search" and more *exhaustive structured extraction over a single document*.
The dominant pattern is a grid: rows = clause types, columns = source docs, cells
filled by per-cell LLM calls grounded in clause spans.

Hebbia Matrix is the canonical example. They explicitly scrapped RAG and went to
an "ISD" (Information / Synthesis / Decomposition) agent-swarm architecture,
claiming 92% accuracy vs. 68% for out-of-the-box RAG, and report that 84% of
real-world finance/legal queries fail standard RAG
([Hebbia "Goodbye RAG"](https://www.hebbia.com/blog/goodbye-rag-how-hebbia-solved-information-retrieval-for-llms),
[OpenAI customer story](https://openai.com/index/hebbia/)).

Chunking strategies that work for contracts:

1. **Structure-aware / hierarchical** — split on contract sections, then clauses.
   LlamaIndex's `HierarchicalNodeParser` is a decent open implementation.
2. **Parent-child** — retrieve at clause granularity, but pass the *enclosing
   section* to the LLM so cross-references resolve.
3. **Sliding-window with 10–20% overlap** — protects against clause/exception
   splits ("...except in cases of...").
4. **Summary-Augmented Chunking (SAC)** — a 2025 NLLP Workshop result; a single
   per-document summary is prepended to each chunk; documented improvements on
   LegalBench-RAG ([NLLP 2025 proceedings](https://aclanthology.org/2025.nllp-1.3.pdf)).
5. **Avoid pure semantic chunking.** One published contract project found
   semantic chunking sliced an advisor name out of the parties section
   ([Contract Analysis RAG case study](https://medium.com/@hillaryke/contract-analysis-rag-a-retrieval-augmented-generation-rag-approach-to-legal-q-a-cdfca428efba)).

Citation/grounding: answers must point back to the exact clause span. Spellbook
(contract drafting) and Hebbia both enforce a "verifiable fact layer" — every
generated cell links to source pixels/text in the original PDF.

Evaluation: [CUAD](https://www.atticusprojectai.org/cuad) (Contract Understanding
Atticus Dataset) for clause extraction, LegalBench-RAG for retrieval precision,
RAGAS for faithfulness / answer correctness / context recall.

Failure modes: clauses split at chunk boundary, cross-reference resolution
failures ("as defined in §1.2"), parties/dates extracted from the wrong contract
when retrieval crosses doc boundaries.

---

## Lane 3 — E-discovery / privilege review at scale

The lane where "just dump it in context" categorically does not work — collections
are millions of documents
([Alvarez & Marsal: TAR to GenAI](https://www.alvarezandmarsal.com/thought-leadership/from-tar-to-genai-rethinking-ediscovery-with-large-language-models)).

The two-stage hybrid that is becoming standard:

1. **Predictive AI (TAR 2.0 / Continuous Active Learning)** for first-pass
   classification — responsiveness, privilege, PII tags. Cuts review volume
   40–60%.
2. **Generative AI on the survivors** — privilege log description drafting,
   summarization, deposition prep. Cost-per-doc is too high to run an LLM on
   millions of items.

Everlaw, Relativity aiR, Reveal, and Lighthouse are the production references.
None of them rely on naive vector RAG over the whole collection; the LLM only
sees documents that TAR + targeted retrieval surfaces.

Chunking is less critical here — most e-discovery items (emails, attachments) are
short. Threading and de-duplication matter more than chunk size.

Citation/grounding: Bates-stamp linking is the norm; every AI-generated
privilege-log entry must reference the Bates range it describes. Human
verification on production sets remains mandatory for defensibility.

Failure modes specific to this lane: **privilege leakage** is the career-ender.
Hallucinated summaries that misrepresent privileged content; prompt injection
from adversarial documents inside the collection (see
[USENIX Security '25 — "Machine Against the RAG"](https://www.usenix.org/system/files/conference/usenixsecurity25/sec25cycle1-prepub-980-shafran.pdf));
inference attacks that aggregate across documents to expose info no single doc
revealed.

---

## Lane 4 — Medical records review for medical malpractice

3,000+ page Epic PDFs, mixed typed and handwritten content, multi-provider,
time-stamped events buried in narrative notes. Deliverables: chronology + red-flag
list + standard-of-care deviation candidates + missing-records gaps.

Architecture preferred in production: almost universally a **structured
extraction pipeline**, not a chat-over-PDF RAG.

- OCR (Tesseract / AWS Textract / Azure Form Recognizer / Google DocAI) or a
  multimodal LLM → entity extraction (dates, providers, dx codes, meds, vitals,
  procedures) → temporal alignment → narrative synthesis with per-event source
  citations (page + bounding box).
- EvenUp's MedChrons and AI Drafts explicitly combine AI extraction with human
  expert review; they process 1,600+ chronologies/week across 1,500+ PI firms.
  Output is a 10–15 page summary linked back to source pages in the underlying
  records ([EvenUp MedChrons](https://www.evenuplaw.com/products/medchrons/),
  [implementation guide](https://www.evenuplaw.com/guides/ai-medical-records-summary-for-lawyers/)).
- Competitors with the same shape:
  [Chronicle](https://www.chroniclelegal.com/blog/best-medical-chronology-software),
  [Superinsight](https://www.superinsight.ai/), Inquery, NexLaw, ProPlaintiff.
- Epic's own **CoMET** foundation model (decoder-only, 118M patients, 115B medical
  events) is research-stage but shows where this is heading: a model that
  natively understands clinical event sequences
  ([Healthcare IT News](https://www.healthcareitnews.com/news/epic-unveils-ai-agents-showcases-new-foundational-models)).

Chunking: page-aware and *encounter-aware*. Each clinical encounter (admission,
ED visit, lab draw, op note) is a natural unit. Sliding-window across page
breaks is essential — vitals tables often run across pages.

Citation/grounding: every chronology entry → page number + line/box coordinate.
This is the only credible defense when opposing counsel says "show me where
that's in the chart." Bounding-box-level citation (not just page number) is the
production standard.

Evaluation: no public benchmark exists for med-mal chronology quality.
EvenUp et al. all run human expert review loops; attorneys spot-check
chronologies against source pages. Build your own gold set from 5–10 closed
cases.

Failure modes specific to this lane:

- **OCR noise on handwriting** — bedside nursing notes, ED triage scribbles.
  Multimodal models (Gemini, Claude with vision) currently outperform
  OCR-then-LLM on handwritten Epic content; this is the strongest single argument
  for keeping a long-context multimodal model in the pipeline.
- **Date ambiguity** — "MM/DD" without year, military time vs. AM/PM, lab draw
  time ≠ result review time.
- **PHI exfiltration via prompt injection** — adversarial text embedded in
  scanned documents (margin notes, OCR'd text outside the visible frame) can
  override system prompts. Documented attack vector
  ([Wiz on prompt injection](https://www.wiz.io/academy/ai-security/prompt-injection-attack),
  [USENIX '25](https://www.usenix.org/system/files/conference/usenixsecurity25/sec25cycle1-prepub-980-shafran.pdf)).
- **Hallucinated dx codes / med doses** — categorically unacceptable; treat any
  unsourced number as a refusal.

---

## Cross-cutting: long-context vs RAG

The "RAG is dead" take is wrong, but so is the "you must build a vector store"
reflex. The 2025 consensus (Databricks long-context RAG study, Thomson Reuters
Labs, [SitePoint analysis](https://www.sitepoint.com/long-context-vs-rag-1m-token-windows/)):

- **Lost-in-the-middle is real and architectural.** RoPE position embeddings
  decay roughly with distance squared; early tokens get more attention cycles
  than middle tokens. Advertised vs. reliable context budgets reported by
  practitioners: Claude 200K → ~130K reliable, Gemini 1M → ~650K reliable, GPT-4
  128K → ~83K reliable. Long-context legal practitioners report clause-extraction
  accuracy drops noticeably past ~400K tokens
  ([Databricks: Long Context RAG Performance](https://www.databricks.com/blog/long-context-rag-performance-llms),
  [arXiv:2411.03538](https://arxiv.org/html/2411.03538v1)).
- **Cost.** At Claude 1M / Opus pricing (~$15/M input tokens) a single
  full-context query is ~$15 in input alone. RAG cuts effective context to
  2K–10K tokens and slashes cost 50–200×.
- **Long context wins** for: single-document deep analysis (100+ page contract,
  single Epic PDF), cross-document contradiction detection, stable corpora,
  prototyping. **RAG wins** for: high QPS, huge corpora (>10M tokens), tight
  latency budgets, frequent corpus updates.
- **The emerging middle path** — used by Hebbia, Harvey, and most serious legal
  AI builders — is *lightweight retrieval selects relevant documents, then
  inject whole documents (not chunks) into long context*. Chunks shred legal
  semantics; whole-document injection preserves them.

For Mike specifically: a single Epic PDF at ~3,000 pages is roughly 1–1.5M
tokens. That straddles the reliable window of every current frontier model.
You will hit the boundary.

---

## Cross-cutting: hybrid retrieval, reranking, GraphRAG

**Hybrid BM25 + dense is the consensus default.** Legal terms ("Section 420 IPC",
"FRCP 26(b)(1)", "Minn. Stat. § 145.682") demand exact lexical match; natural
language queries demand semantics. Reported gains on COLIEE and regulatory
corpora: recall 0.72 → 0.91, precision 0.68 → 0.87 vs. BM25 alone
([arXiv:2502.16767](https://arxiv.org/html/2502.16767v1)). **Reciprocal Rank
Fusion (k=60)** is the no-tuning fusion default most production systems use.

Rerankers actually in use:

- **Cohere Rerank v3.5** — easiest path, strong general performance. *But* the
  LegalBench-RAG authors explicitly flagged that a general-purpose Cohere
  reranker *hurt* retrieval in legal contexts vs. domain-tuned options. Use with
  caution; benchmark on your own corpus
  ([LegalBench-RAG Medium summary](https://medium.com/@ghitahouiralami/legalbench-rag-the-first-open-source-retrieval-benchmark-for-the-legal-domain-bbacc015d109)).
- **Cross-encoders (BGE-reranker, MS-MARCO MiniLM)** — highest accuracy, but
  slow; cap at top-50 candidates.
- **ColBERT / late interaction** — ColBERT p50 ~23ms vs. cross-encoder p99.9 21s
  at 40 QPS; the right call when you have QPS pressure and still want
  near-cross-encoder quality.
- **AnswerDotAI's `rerankers`** library wraps all of these behind one interface,
  including domain-tuned options like Isaacus for legal.

**GraphRAG for case law:** highly applicable for citator / Shepardizing-style
work, less so for med-mal records. SAT-Graph RAG
([arXiv:2505.00039](https://arxiv.org/abs/2505.00039), Sept 2025) reifies
legislative events as first-class "Action nodes" — directly analogous to how
Shepard's tracks overruling/distinguishing/following. Combined with hierarchical
vector retrieval, it beats either alone for statutory questions
([Neo4j legal docs blog](https://neo4j.com/blog/developer/from-legal-documents-to-knowledge-graphs/)).
Skip for med-mal unless you're building citator features.

**Open-source frameworks worth a look:**

- **[RAGFlow](https://github.com/infiniflow/ragflow)** — most "turnkey,"
  document-structure-aware, citation-first UX, explicitly positioned for
  legal/compliance.
- **[LlamaIndex `CitationQueryEngine`](https://developers.llamaindex.ai/python/examples/workflow/citation_query_engine/)**
  — clean primitives (`CITATION_QA_TEMPLATE`, `CITATION_REFINE_TEMPLATE`) for
  in-line citations; framework-level building blocks rather than a product.
- **[PaperQA2](https://github.com/future-house/paper-qa)** —
  scientific-literature-focused but the agentic RAG + metadata-aware citation
  patterns transfer; framework-agnostic and customizable.

---

## For the Mike use case (med-mal records)

You are not building Westlaw. You are building a system that turns a 3,000-page
Epic PDF into a defensible chronology with sourced red flags. The state of the
art in this lane (EvenUp, Chronicle, Superinsight) is **not** "chat with your
PDF over an embedding store." It is a structured extraction pipeline with
bounding-box citations and a human review loop.

Two-sentence recommendation:

1. Keep the long-context + tool-use core; do *not* bolt on a vector store yet.
2. Add a one-time, per-record structured extraction pass that emits a JSON event
   log anchored to `{source_page, source_bbox}`, plus a deterministic red-flag
   rule library running over that log. Page-window retrieval for chat replaces
   raw-document injection.

The concrete build plan is in
[PLAN_med_mal_extraction_pipeline.md](./PLAN_med_mal_extraction_pipeline.md).

---

## Sources (key)

- [Stanford RegLab — Hallucination-Free? (J. Empirical Legal Studies 2025)](https://reglab.stanford.edu/publications/hallucination-free-assessing-the-reliability-of-leading-ai-legal-research-tools/)
- [LegalBench-RAG (arXiv:2408.10343)](https://arxiv.org/abs/2408.10343) and
  [original LegalBench (arXiv:2308.11462)](https://arxiv.org/abs/2308.11462)
- [L-MARS multi-agent legal workflow (arXiv:2509.00761)](https://arxiv.org/html/2509.00761v2)
- [SAT-Graph RAG for legal norms (arXiv:2505.00039)](https://arxiv.org/abs/2505.00039)
- [Hebbia "Goodbye RAG"](https://www.hebbia.com/blog/goodbye-rag-how-hebbia-solved-information-retrieval-for-llms)
  and [OpenAI's Hebbia writeup](https://openai.com/index/hebbia/)
- [Harvey AI on case-law system architecture (LawNext)](https://www.lawnext.com/2024/05/harvey-ai-to-move-out-of-early-access-phase-release-more-affordable-versions-of-its-custom-ai-models.html)
- [EvenUp MedChrons](https://www.evenuplaw.com/products/medchrons/) and
  [implementation guide](https://www.evenuplaw.com/guides/ai-medical-records-summary-for-lawyers/)
- [Alvarez & Marsal: From TAR to GenAI in e-discovery](https://www.alvarezandmarsal.com/thought-leadership/from-tar-to-genai-rethinking-ediscovery-with-large-language-models)
- [Summary-Augmented Chunking (NLLP Workshop 2025)](https://aclanthology.org/2025.nllp-1.3.pdf)
- [Hybrid BM25+dense for regulatory texts (arXiv:2502.16767)](https://arxiv.org/html/2502.16767v1)
- [Databricks: Long Context RAG Performance](https://www.databricks.com/blog/long-context-rag-performance-llms)
  and [arXiv:2411.03538](https://arxiv.org/html/2411.03538v1)
- [USENIX Security 2025: Machine Against the RAG](https://www.usenix.org/system/files/conference/usenixsecurity25/sec25cycle1-prepub-980-shafran.pdf)
- [Thomson Reuters Labs: RAG in the era of long-context LLMs](https://medium.com/tr-labs-ml-engineering-blog/rag-in-the-era-of-long-context-llms-b8ecda2d5693)
- [RAGFlow](https://github.com/infiniflow/ragflow) ·
  [PaperQA2](https://github.com/future-house/paper-qa) ·
  [LlamaIndex CitationQueryEngine](https://developers.llamaindex.ai/python/examples/workflow/citation_query_engine/)
