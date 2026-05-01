import { extractTranscript } from './extract.service'
import { evaluateCase } from './evaluate.service'
import { loadGold, loadTranscript, listTranscriptIds } from './dataset.service'
import { createRunRecord, loadRun, updateRun, addCaseResult, listRuns } from './store.service'
import type { CaseMetrics, RunRequest, RunResult, TokenUsage } from '../../../../packages/shared/src/index'
import { promptVersionHash } from '../../../../packages/llm/src/strategies'

// ---------------------------------------------------------------------------
// Semaphore — caps concurrent Anthropic calls at 5
// ---------------------------------------------------------------------------
class Semaphore {
  private tokens: number
  private waiting: Array<() => void>

  constructor(limit: number) {
    this.tokens = limit
    this.waiting = []
  }

  acquire() {
    return new Promise<void>((resolve) => {
      if (this.tokens > 0) {
        this.tokens -= 1
        resolve()
        return
      }
      this.waiting.push(resolve)
    })
  }

  release() {
    this.tokens += 1
    const next = this.waiting.shift()
    if (next) {
      this.tokens -= 1
      next()
    }
  }
}

// ---------------------------------------------------------------------------
// SSE Pub/Sub — lets the /stream route subscribe to per-run events
// ---------------------------------------------------------------------------
export type RunEvent =
  | { type: 'case_complete'; transcriptId: string; scores: Record<string, number>; attempt: number; cached: boolean; hallucinationCount?: number }
  | { type: 'case_error'; transcriptId: string; error: string }
  | { type: 'run_complete'; aggregateF1: number; totalCostUsd: number; totalTokens: TokenUsage; wallTimeMs: number }
  | { type: 'error'; message: string }

type Subscriber = (event: RunEvent) => void | Promise<void>
const subscribers = new Map<string, Set<Subscriber>>()

function publish(runId: string, event: RunEvent): void {
  const subs = subscribers.get(runId)
  if (!subs) return
  for (const sub of subs) {
    Promise.resolve(sub(event)).catch(console.error)
  }
}

/**
 * Subscribe to SSE events for a given runId.
 * Returns an unsubscribe function — call it when the SSE connection closes.
 */
export function subscribeToRun(runId: string, cb: Subscriber): () => void {
  if (!subscribers.has(runId)) subscribers.set(runId, new Set())
  subscribers.get(runId)!.add(cb)
  return () => subscribers.get(runId)?.delete(cb)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalizeRequest(request: RunRequest) {
  const filtered = request.dataset_filter?.slice().sort().join(',') ?? ''
  return `${request.strategy}|${request.model}|${filtered}`
}

async function hashString(value: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startRun(request: RunRequest) {
  const requestHash = await hashString(normalizeRequest(request))
  const existing = (await listRuns()).find((run) => run.requestHash === requestHash)
  if (existing && !request.force) {
    return existing
  }

  const transcriptIds = request.dataset_filter ?? (await listTranscriptIds())
  const promptHash = await promptVersionHash(request.strategy)
  const run = await createRunRecord(request, promptHash, requestHash)
  run.status = 'running'
  await updateRun(run)

  processRun(run, transcriptIds).catch(async (error) => {
    run.status = 'failed'
    await updateRun(run)
    publish(run.id, { type: 'error', message: String(error) })
    console.error('Run failed', error)
  })

  return run
}

export async function resumeRun(runId: string) {
  const run = await loadRun(runId)
  if (!run) throw new Error(`Run ${runId} not found`)
  const transcriptIds = run.datasetFilter ?? (await listTranscriptIds())
  run.status = 'running'
  await updateRun(run)

  processRun(run, transcriptIds).catch(async (error) => {
    const latest = await loadRun(run.id)
    if (latest) {
      latest.status = 'failed'
      await updateRun(latest)
    }
    publish(runId, { type: 'error', message: String(error) })
    console.error('Run failed', error)
  })

  return run
}

export async function runToCompletion(request: RunRequest) {
  const requestHash = await hashString(normalizeRequest(request))
  const existing = (await listRuns()).find((run) => run.requestHash === requestHash)
  if (existing && !request.force && existing.status === 'completed') {
    return existing
  }

  const transcriptIds = request.dataset_filter ?? (await listTranscriptIds())
  const promptHash = await promptVersionHash(request.strategy)
  const run = existing && request.force !== true
    ? existing
    : await createRunRecord(request, promptHash, requestHash)
  run.status = 'running'
  await updateRun(run)
  return processRun(run, transcriptIds)
}

// ---------------------------------------------------------------------------
// Core runner — processes all cases with semaphore + SSE events
// ---------------------------------------------------------------------------
async function processRun(run: RunResult, transcriptIds: string[]) {
  const semaphore = new Semaphore(5)
  const start = Date.now()

  const tasks = transcriptIds.map(async (transcriptId) => {
    await semaphore.acquire()
    try {
      const transcript = await loadTranscript(transcriptId)

      // Idempotency: skip already-completed cases (supports resumability)
      const latest = await loadRun(run.id)
      const existingCase = latest?.cases.find((c) => c.transcriptId === transcriptId)
      if (existingCase) {
        // Replay event so SSE clients see progress on reconnect
        publish(run.id, {
          type: 'case_complete',
          transcriptId,
          scores: flattenScores(existingCase.scores),
          attempt: existingCase.attempts?.length ?? 1,
          cached: true,
          hallucinationCount: existingCase.hallucinations,
        })
        return
      }

      const gold = await loadGold(transcriptId)
      const extraction = await extractTranscript(transcript, run.strategy, run.model)
      const metrics = evaluateCase(transcriptId, transcript, gold, extraction.prediction, extraction.schemaValid)
      const tokens = tokensFromAttempts(extraction.attempts)

      const caseResult: CaseMetrics = {
        ...metrics,
        transcriptId,
        prediction: extraction.prediction,
        gold,
        attempts: extraction.attempts,
        tokens,
      }

      await addCaseResult(run.id, caseResult)

      // Publish SSE event so dashboard updates live
      publish(run.id, {
        type: 'case_complete',
        transcriptId,
        scores: flattenScores(metrics.scores),
        attempt: extraction.attempts.length,
        cached: false,
        hallucinationCount: metrics.hallucinations,
      })
    } catch (error) {
      console.error('Case failed', transcriptId, error)
      publish(run.id, { type: 'case_error', transcriptId, error: String(error) })
    } finally {
      semaphore.release()
    }
  })

  await Promise.all(tasks)

  // Aggregate final scores
  const finalRun = (await loadRun(run.id)) ?? run
  finalRun.totalWallTimeMs += Date.now() - start
  finalRun.totalTokens = finalRun.cases.reduce<TokenUsage>(
    (totals, caseItem) => ({
      input: totals.input + (caseItem.tokens?.input ?? 0),
      output: totals.output + (caseItem.tokens?.output ?? 0),
      cacheRead: totals.cacheRead + (caseItem.tokens?.cacheRead ?? 0),
      cacheWrite: totals.cacheWrite + (caseItem.tokens?.cacheWrite ?? 0),
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  )
  finalRun.schemaFailureCount = finalRun.cases.filter((c) => !c.schemaValid).length
  finalRun.hallucinationCount = finalRun.cases.reduce((sum, c) => sum + c.hallucinations, 0)
  finalRun.fieldAggregates = calculateFieldAggregates(finalRun.cases)
  finalRun.totalCostUsd = calculateCost(finalRun.totalTokens)
  finalRun.status = finalRun.cases.length === transcriptIds.length ? 'completed' : 'failed'
  finalRun.completedAt = new Date().toISOString()
  await updateRun(finalRun)

  // Publish run_complete SSE event
  publish(run.id, {
    type: 'run_complete',
    aggregateF1: finalRun.fieldAggregates.aggregate,
    totalCostUsd: finalRun.totalCostUsd,
    totalTokens: finalRun.totalTokens,
    wallTimeMs: finalRun.totalWallTimeMs,
  })

  return finalRun
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function flattenScores(scores: CaseMetrics['scores']): Record<string, number> {
  return {
    chief_complaint: scores.chief_complaint,
    vitals: scores.vitals.average,
    medications: scores.medications.f1,
    diagnoses: scores.diagnoses.f1,
    plan: scores.plan.f1,
    follow_up: scores.follow_up,
    aggregate: scores.aggregate,
  }
}

function calculateCost(tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
  return (
    tokens.input * 0.0000008 +
    tokens.output * 0.000004 +
    tokens.cacheRead * 0.00000008 +
    tokens.cacheWrite * 0.000001
  )
}

function tokensFromAttempts(
  attempts: Array<{ requestTokens: number; responseTokens: number; cacheReadTokens: number; cacheWriteTokens: number }>
): TokenUsage {
  return attempts.reduce<TokenUsage>(
    (totals, attempt) => ({
      input: totals.input + attempt.requestTokens,
      output: totals.output + attempt.responseTokens,
      cacheRead: totals.cacheRead + attempt.cacheReadTokens,
      cacheWrite: totals.cacheWrite + attempt.cacheWriteTokens,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  )
}

function calculateFieldAggregates(cases: CaseMetrics[]) {
  if (!cases.length) {
    return { chief_complaint: 0, vitals: 0, medications: 0, diagnoses: 0, plan: 0, follow_up: 0, aggregate: 0 }
  }
  const sum = cases.reduce(
    (totals, c) => ({
      chief_complaint: totals.chief_complaint + c.scores.chief_complaint,
      vitals: totals.vitals + c.scores.vitals.average,
      medications: totals.medications + c.scores.medications.f1,
      diagnoses: totals.diagnoses + c.scores.diagnoses.f1,
      plan: totals.plan + c.scores.plan.f1,
      follow_up: totals.follow_up + c.scores.follow_up,
      aggregate: totals.aggregate + c.scores.aggregate,
    }),
    { chief_complaint: 0, vitals: 0, medications: 0, diagnoses: 0, plan: 0, follow_up: 0, aggregate: 0 }
  )
  const n = cases.length
  return {
    chief_complaint: sum.chief_complaint / n,
    vitals: sum.vitals / n,
    medications: sum.medications / n,
    diagnoses: sum.diagnoses / n,
    plan: sum.plan / n,
    follow_up: sum.follow_up / n,
    aggregate: sum.aggregate / n,
  }
}
