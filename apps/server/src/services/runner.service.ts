import { extractTranscript } from './extract.service'
import { evaluateCase } from './evaluate.service'
import { loadGold, loadTranscript, listTranscriptIds } from './dataset.service'
import { createRunRecord, loadRun, updateRun, addCaseResult, listRuns } from './store.service'
import type { CaseMetrics, RunRequest, RunResult, TokenUsage } from '../../../../packages/shared/src/index'
import { promptVersionHash } from '../../../../packages/llm/src/strategies'

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

function normalizeRequest(request: RunRequest) {
  const filtered = request.dataset_filter?.slice().sort().join(',') ?? ''
  return `${request.strategy}|${request.model}|${filtered}`
}

async function hashString(value: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

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
  const run = existing && request.force !== true ? existing : await createRunRecord(request, promptHash, requestHash)
  run.status = 'running'
  await updateRun(run)
  return processRun(run, transcriptIds)
}

async function processRun(run: RunResult, transcriptIds: string[]) {
  const semaphore = new Semaphore(5)
  const start = Date.now()
  const tasks = transcriptIds.map(async (transcriptId) => {
    await semaphore.acquire()
    try {
      const transcript = await loadTranscript(transcriptId)
      const latest = await loadRun(run.id)
      const existingCase = latest?.cases.find((c) => c.transcriptId === transcriptId)
      if (existingCase) return

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
        tokens
      }
      await addCaseResult(run.id, caseResult)
    } catch (error) {
      console.error('Case failed', transcriptId, error)
    } finally {
      semaphore.release()
    }
  })

  await Promise.all(tasks)
  const finalRun = (await loadRun(run.id)) ?? run
  finalRun.totalWallTimeMs += Date.now() - start
  finalRun.totalTokens = finalRun.cases.reduce<TokenUsage>(
    (totals, caseItem) => ({
      input: totals.input + (caseItem.tokens?.input ?? 0),
      output: totals.output + (caseItem.tokens?.output ?? 0),
      cacheRead: totals.cacheRead + (caseItem.tokens?.cacheRead ?? 0),
      cacheWrite: totals.cacheWrite + (caseItem.tokens?.cacheWrite ?? 0)
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  )
  finalRun.schemaFailureCount = finalRun.cases.filter((caseItem) => !caseItem.schemaValid).length
  finalRun.hallucinationCount = finalRun.cases.reduce((sum, caseItem) => sum + caseItem.hallucinations, 0)
  finalRun.fieldAggregates = calculateFieldAggregates(finalRun.cases)
  finalRun.totalCostUsd = calculateCost(finalRun.totalTokens)
  finalRun.status = finalRun.cases.length === transcriptIds.length ? 'completed' : 'failed'
  finalRun.completedAt = new Date().toISOString()
  await updateRun(finalRun)
  return finalRun
}

function calculateCost(tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
  const inputCost = tokens.input * 0.0000008
  const outputCost = tokens.output * 0.000004
  const cacheReadCost = tokens.cacheRead * 0.00000008
  const cacheWriteCost = tokens.cacheWrite * 0.000001
  return inputCost + outputCost + cacheReadCost + cacheWriteCost
}

function tokensFromAttempts(attempts: Array<{ requestTokens: number; responseTokens: number; cacheReadTokens: number; cacheWriteTokens: number }>): TokenUsage {
  return attempts.reduce<TokenUsage>(
    (totals, attempt) => ({
      input: totals.input + attempt.requestTokens,
      output: totals.output + attempt.responseTokens,
      cacheRead: totals.cacheRead + attempt.cacheReadTokens,
      cacheWrite: totals.cacheWrite + attempt.cacheWriteTokens
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  )
}

function calculateFieldAggregates(cases: CaseMetrics[]) {
  if (!cases.length) {
    return { chief_complaint: 0, vitals: 0, medications: 0, diagnoses: 0, plan: 0, follow_up: 0, aggregate: 0 }
  }
  const sum = cases.reduce(
    (totals, caseItem) => ({
      chief_complaint: totals.chief_complaint + caseItem.scores.chief_complaint,
      vitals: totals.vitals + caseItem.scores.vitals.average,
      medications: totals.medications + caseItem.scores.medications.f1,
      diagnoses: totals.diagnoses + caseItem.scores.diagnoses.f1,
      plan: totals.plan + caseItem.scores.plan.f1,
      follow_up: totals.follow_up + caseItem.scores.follow_up,
      aggregate: totals.aggregate + caseItem.scores.aggregate
    }),
    { chief_complaint: 0, vitals: 0, medications: 0, diagnoses: 0, plan: 0, follow_up: 0, aggregate: 0 }
  )
  return {
    chief_complaint: sum.chief_complaint / cases.length,
    vitals: sum.vitals / cases.length,
    medications: sum.medications / cases.length,
    diagnoses: sum.diagnoses / cases.length,
    plan: sum.plan / cases.length,
    follow_up: sum.follow_up / cases.length,
    aggregate: sum.aggregate / cases.length
  }
}
