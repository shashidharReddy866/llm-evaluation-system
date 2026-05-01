# HEALOSBENCH - Eval Harness for Structured Clinical Extraction

A lightweight end-to-end evaluation harness for extracting structured clinical data from synthetic transcripts.

## What's Included

- `apps/server`: Hono server with dataset loading, Anthropic/mock extraction, retry validation, evaluator, runner, and API endpoints.
- `apps/web`: Minimal Next.js dashboard for run listing, run detail, traces, and comparison.
- `packages/llm`: Anthropic Messages tool-use wrapper, prompt strategies, prompt hashing, retry support, and `MOCK_LLM=true` fallback.
- `packages/shared`: Shared schema types, run metadata, and evaluation DTOs.
- `packages/db`: Drizzle ORM schema and persistence helpers.
- `packages/env`: Typed environment loading.
- `data`: Synthetic transcripts, gold labels, and JSON schema.
- `tests`: Core unit tests covering fuzzy matching, retry flows, rate-limit backoff, mock mode, idempotency, and resumability.

## Quick Start

1. Install dependencies:

```bash
bun install
```

2. Add environment variables for real Anthropic runs:

```bash
cp apps/server/.env.example apps/server/.env
# then edit apps/server/.env and set ANTHROPIC_API_KEY
```

For local demos without paid Anthropic calls, set:

```env
MOCK_LLM=true
```

Mock mode is deterministic and schema-valid, but it is only a demo/CI fallback. Real assignment results should use Anthropic with `MOCK_LLM=false` or unset.

3. Start development servers in separate terminals:

```bash
bun run dev:server
bun run dev:web
```

4. Run a CLI evaluation:

```bash
bun run eval -- --strategy=zero_shot
```
