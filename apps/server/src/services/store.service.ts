import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import type { RunRequest, RunResult, CaseMetrics } from '../../../../packages/shared/src/index'

const dataDir = path.resolve('src', '.data')
const storeFile = path.join(dataDir, 'runs.json')
let storeQueue = Promise.resolve()

function withStoreLock<T>(operation: () => Promise<T>) {
  const next = storeQueue.then(operation, operation)
  storeQueue = next.then(
    () => undefined,
    () => undefined
  )
  return next
}

async function ensureStoreLocation() {
  await mkdir(dataDir, { recursive: true })
}

async function readStore() {
  await ensureStoreLocation()
  try {
    const text = await readFile(storeFile, 'utf-8')
    return JSON.parse(text) as Record<string, RunResult>
  } catch {
    return {}
  }
}

async function writeStore(store: Record<string, RunResult>) {
  await ensureStoreLocation()
  await writeFile(storeFile, JSON.stringify(store, null, 2), 'utf-8')
}

export async function saveRun(result: RunResult) {
  return withStoreLock(async () => {
    const store = await readStore()
    store[result.id] = result
    await writeStore(store)
  })
}

export async function loadRun(runId: string) {
  const store = await readStore()
  return store[runId] ?? null
}

export async function listRuns() {
  const store = await readStore()
  return Object.values(store)
}

export async function createRunRecord(request: RunRequest, promptHash: string, requestHash: string) {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const record: RunResult = {
    id,
    strategy: request.strategy,
    model: request.model,
    promptHash,
    requestHash,
    datasetFilter: request.dataset_filter,
    status: 'pending',
    createdAt: now,
    totalCostUsd: 0,
    totalWallTimeMs: 0,
    schemaFailureCount: 0,
    hallucinationCount: 0,
    fieldAggregates: {
      chief_complaint: 0,
      vitals: 0,
      medications: 0,
      diagnoses: 0,
      plan: 0,
      follow_up: 0,
      aggregate: 0
    },
    totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cases: []
  }
  await saveRun(record)
  return record
}

export async function updateRun(record: RunResult) {
  await saveRun(record)
}

export async function addCaseResult(runId: string, caseMetrics: CaseMetrics) {
  return withStoreLock(async () => {
    const store = await readStore()
    const run = store[runId]
    if (!run) throw new Error(`Run ${runId} not found`)
    run.cases = run.cases.filter((c) => c.transcriptId !== caseMetrics.transcriptId)
    run.cases.push(caseMetrics)
    store[runId] = run
    await writeStore(store)
  })
}
