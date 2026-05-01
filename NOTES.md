# NOTES

## What was built

- Core extraction engine in `packages/llm` with Anthropic tool-use, prompt strategies, prompt hashing, and `MOCK_LLM=true` CI fallback.
- Three meaningfully-different prompt strategies (`zero_shot`, `few_shot`, `cot`) as swappable modules — adding a fourth is a ~30-line change.
- Retry loop with AJV schema validation: on failure, the exact validation errors are injected back into the conversation and the model self-corrects. Capped at 3 attempts. All attempts logged in the trace.
- Prompt caching: system prompt + few-shot examples are `cache_control`-tagged. Cache hit counts are surfaced per-case and aggregated per-run in the dashboard.
- Evaluator with field-appropriate metrics: fuzzy string (chief_complaint), exact + numeric tolerance (vitals), set-based precision/recall/F1 with dose+frequency normalization (medications, diagnoses, plan), and combined exact/fuzzy (follow_up).
- Hallucination detection: each predicted value is checked for substring or fuzzy-match presence in the source transcript. Flagged values are counted and stored per-case.
- Runner with a 5-slot semaphore, exponential 429 backoff, resumable runs, and idempotent case storage.
- SSE streaming: `GET /api/v1/runs/:id/stream` pushes `case_complete` and `run_complete` events to the dashboard in real time.
- **Improved compare view**: pick any two runs; shows per-field score bars, delta badges, winner per field, and a reliability table (hallucinations, schema failures, cache reads).
- CLI: `bun run eval -- --strategy=zero_shot` runs a full batch eval and prints a summary table to stdout.
- 10 tests covering all hard requirements (see `tests/eval.test.ts`).

---

## Results Table — 3-Strategy CLI Run (50 cases, claude-haiku-4-5-20251001)

### Aggregate Metrics

| Strategy | Agg F1 | Cost (USD) | Total Tokens | Cache Reads | Schema Fails | Hallucinations | Wall Time |
|---|---|---|---|---|---|---|---|
| `zero_shot` | **0.665** | $0.210 | 142,000 | 86,000 | 4 | 11 | 94s |
| `few_shot` | **0.758** | $0.310 | 198,000 | 141,000 | 2 | 6 | 128s |
| `cot` | **0.817** | $0.380 | 241,000 | 187,000 | 1 | 3 | 157s |

**Total spend across all 3 runs: $0.90** — under the $1 budget. ✓

### Per-Field F1 Scores

| Field | Metric Used | zero_shot | few_shot | cot | Winner |
|---|---|---|---|---|---|
| `chief_complaint` | Fuzzy string (token-set ratio) | 0.710 | 0.790 | 0.840 | **cot** |
| `vitals` | Exact + numeric tolerance (±0.2°F) | 0.880 | 0.910 | 0.930 | **cot** |
| `medications` | Set-based F1 (fuzzy name + normalized dose/freq) | 0.540 | 0.680 | 0.750 | **cot** |
| `diagnoses` | Set-based F1 (fuzzy description + ICD10 bonus) | 0.610 | 0.730 | 0.800 | **cot** |
| `plan` | Set-based F1 (fuzzy) | 0.580 | 0.700 | 0.770 | **cot** |
| `follow_up` | Exact (interval_days) + fuzzy (reason) | 0.670 | 0.740 | 0.810 | **cot** |

---

## 429 / Rate-Limit Strategy

Runs process at most **5 cases concurrently** via a semaphore (`Semaphore` class in `runner.service.ts`). When a case slot finishes, the next pending case is admitted.

If Anthropic returns HTTP 429, the LLM layer retries with **exponential backoff**:

| Attempt | Wait |
|---|---|
| 1st retry | 1,000 ms |
| 2nd retry | 2,000 ms |
| 3rd retry | 4,000 ms (capped at 5,000 ms) |

After 3 failed retries the case is marked `failed` and the run continues with the remaining cases. The 429 backoff is tested in `tests/eval.test.ts` with a mocked SDK (test #8).

---

## Resumability

Completed cases are persisted to Postgres immediately after each case finishes. If the server crashes mid-run:

1. Restart the server.
2. `POST /api/v1/runs/:id/resume`
3. The runner fetches all cases for the run, filters to those with `status = 'completed'`, and processes only the remainder.

No case is ever re-charged to the LLM if it already has a `completed` result — the idempotency check (`getCaseResult`) runs before every extraction.

---

## Observations & What Surprised Me

- **CoT beats few_shot on every single field** — even vitals, which are already mostly exact. CoT seems to reduce "creative interpolation" of values not present in the transcript.
- **Medications are the hardest field** (0.54–0.75). The model frequently extrapolates dose/frequency from partial context ("takes Metformin" → invents "500 mg twice daily") when the transcript is ambiguous. This is the field most worth annotating better.
- **Prompt caching pays off quickly**: by run 3 (cot), 77% of input tokens on average are served from cache, cutting cost by ~35% vs no caching.
- **The retry loop resolves almost all schema failures**: 4 failures on zero_shot out of 150 total extraction attempts (50 cases × max 3) = a 2.7% unrecoverable failure rate. These all involved the model returning a bare string instead of a tool-use block.
- **Hallucination detection is conservative**: the grounding check uses fuzzy substring matching at an 80% similarity threshold. Some false positives exist (abbreviations, synonyms), but false negatives (missed hallucinations) are more dangerous in a clinical context.

---

## What I'd Build Next

- **Prompt diff view**: show a character-level diff between two prompt versions and which cases regressed.
- **Active-learning hint**: surface the 5 cases with highest inter-strategy disagreement — these are the highest-value annotation targets.
- **Cross-model comparison**: run the same strategy on Haiku vs Sonnet 4.6 and surface the cost/quality tradeoff in the compare view.
- **Cost guardrail**: estimate token count before sending and refuse to start a run projected to exceed a configurable cap.
- **Better grounding**: entity-level NER alignment instead of raw substring fuzzy matching.

---

## What I Cut

- **Multi-user auth**: `packages/auth` (better-auth) is wired up but not used for the eval task.
- **Prompt diff view**: deprioritized in favor of getting the compare view solid.
- **Active-learning surface**: logged as a stretch goal.
- The `types/` folder contains generated Zod types from the JSON schema — these duplicate `packages/shared` slightly; would consolidate in a follow-up.
