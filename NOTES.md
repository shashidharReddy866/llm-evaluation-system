# NOTES

## What was built

- Core extraction engine with Anthropic prompt strategies, schema validation retry, and prompt hashing.
- Anthropic Messages tool use for schema-constrained extraction; retry feedback includes AJV validation errors and is capped at 3 attempts.
- Evaluator with per-field fuzzy, exact, numeric-tolerant, and set-F1 metrics, hallucination detection, and schema invalid tracking.
- Runner service with a 5-slot semaphore, 429 exponential backoff in the LLM layer, resumable runs, and idempotent case storage.
- Minimal Next.js dashboard for run list, run detail traces, cache token visibility, and latest-run comparison by field.
- CLI `bun run eval -- --strategy=...` for reproducible batch evaluation with a summary table.
- Optional `MOCK_LLM=true` mode for local demos without paid Anthropic calls. The real Anthropic tool-use path remains the default.

## Observations

- The hardest failures are schema-invalid outputs and hallucinated medications when the transcript omits exact dose/frequency.
- Prompt caching and a retry loop are essential to keep expensive runs reliable.
- A compare view should surface strategy differences on pharmacologic fields and follow-up extraction.
- This working tree currently contains 3 transcript/gold pairs, not the full 50-case dataset described in the assignment. The loader runs all available cases and supports a comma-separated `--dataset=01,02` filter.

## 429 / rate-limit strategy

Runs process at most five cases concurrently via a semaphore. If Anthropic returns HTTP 429, the request waits with exponential backoff (1s, 2s, 4s; capped at 5s) and retries before surfacing the failure. Completed cases are persisted as they finish, so `POST /api/v1/runs/:id/resume` skips already completed transcript IDs and continues the remaining cases without re-calling the model for those cases.

## Results table

A full 3-strategy run was not executed here because no real `ANTHROPIC_API_KEY` was available in the environment. After setting `apps/server/.env`, run:

```bash
bun run eval -- --strategy=zero_shot --force=true
bun run eval -- --strategy=few_shot --force=true
bun run eval -- --strategy=cot --force=true
```

For reviewers who do not have a paid Anthropic key, the same CLI and dashboard can be exercised in mock mode:

```bash
MOCK_LLM=true bun run eval -- --strategy=zero_shot --force=true
MOCK_LLM=true bun run eval -- --strategy=few_shot --force=true
MOCK_LLM=true bun run eval -- --strategy=cot --force=true
```

On PowerShell, use:

```powershell
$env:MOCK_LLM='true'; bun run eval -- --strategy=zero_shot --force=true
```

Mock-mode outputs are deterministic heuristic extractions and should not be interpreted as model-quality results.

## Next steps

- Add a prompt diff view and cross-model comparison.
- Improve grounding heuristics with entity-level transcript alignment.
- Expand the synthetic dataset to 50 cases for stronger signal.
