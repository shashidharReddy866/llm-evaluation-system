import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { tokenSetScore, normalizeFrequency, normalizeDose } from '../apps/server/src/services/utils'
import { evaluateCase } from '../apps/server/src/services/evaluate.service'
import { promptVersionHash } from '../packages/llm/src/strategies'
import { extractWithAnthropic } from '../packages/llm/src/index'
import { readFile, writeFile, mkdir, rm } from 'fs/promises'
import path from 'path'

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key'

const transcript = 'Patient is on lisinopril 10 mg daily. She reports chest pressure. Vitals are 120/80, 80 bpm, 98.6 F, 97% SpO2.'
const groundedTranscript = 'Patient is on lisinopril 10 mg daily by mouth. She reports chest pressure. Vitals are 120/80, 80 bpm, 98.6 F, 97% SpO2. The provider diagnoses hypertension. Continue lisinopril orally. Recheck blood pressure. Follow up in 14 days for blood pressure follow up.'
const gold = {
  chief_complaint: 'Chest pressure',
  vitals: { bp: '120/80', hr: 80, temp_f: 98.6, spo2: 97 },
  medications: [{ name: 'lisinopril', dose: '10 mg', frequency: 'daily', route: 'oral' }],
  diagnoses: [{ description: 'hypertension', icd10: null }],
  plan: ['continue lisinopril', 'recheck blood pressure'],
  follow_up: { interval_days: 14, reason: 'blood pressure follow up' }
}

const groundedPrediction = {
  chief_complaint: 'Chest pressure',
  vitals: { bp: '120/80', hr: 80, temp_f: 98.6, spo2: 97 },
  medications: [{ name: 'lisinopril', dose: '10 mg', frequency: 'daily', route: 'oral' }],
  diagnoses: [{ description: 'hypertension', icd10: null }],
  plan: ['continue lisinopril', 'recheck blood pressure'],
  follow_up: { interval_days: 14, reason: 'blood pressure follow up' }
}

const hallucinatedPrediction = {
  ...groundedPrediction,
  medications: [
    ...groundedPrediction.medications,
    { name: 'metformin', dose: '500 mg', frequency: 'daily', route: 'oral' }
  ]
}

describe('Evaluation utilities', () => {
  it('computes text similarity for fuzzy matching', () => {
    expect(tokenSetScore('chest pain', 'chest pressure')).toBeGreaterThanOrEqual(0.5)
    expect(tokenSetScore('headache', 'knee pain')).toBeLessThan(0.2)
  })

  it('normalizes medication frequency and dose consistently', () => {
    expect(normalizeFrequency('BID')).toBe('twice daily')
    expect(normalizeFrequency('as needed')).toBe('as needed')
    expect(normalizeDose(' 10 mg ')).toBe('10 mg')
  })

  it('computes set-F1 correctly for plan and diagnosis matching', () => {
    const caseResult = evaluateCase('test', transcript, gold, groundedPrediction, true)
    expect(caseResult.scores.plan.f1).toBeGreaterThan(0.9)
    expect(caseResult.scores.diagnoses.f1).toBe(1)
  })

  it('detects hallucinated values inside predictions', () => {
    const caseResult = evaluateCase('test', transcript, gold, hallucinatedPrediction, true)
    expect(caseResult.hallucinations).toBeGreaterThan(0)
  })

  it('does not flag grounded predictions as hallucinations', () => {
    const caseResult = evaluateCase('test', groundedTranscript, gold, groundedPrediction, true)
    expect(caseResult.hallucinations).toBe(0)
  })

  it('keeps prompt hash stable across calls', async () => {
    const first = await promptVersionHash('zero_shot')
    const second = await promptVersionHash('zero_shot')
    expect(first).toBe(second)
  })
})

describe('Anthropic wrapper', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('retries on schema-invalid responses and succeeds once valid output is returned', async () => {
    let attempts = 0
    globalThis.fetch = (async () => {
      attempts += 1
      if (attempts === 1) {
        return new Response(JSON.stringify({ content: [], usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200 })
      }
      return new Response(JSON.stringify({
        content: [{ type: 'tool_use', name: 'record_clinical_extraction', input: groundedPrediction }],
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 }
      }), { status: 200 })
    }) as unknown as typeof fetch
    const result = await extractWithAnthropic(transcript, 'zero_shot', 'test-model')
    expect(result.output).toEqual(groundedPrediction)
    expect(result.attempts.length).toBeGreaterThanOrEqual(2)
  })

  it('backs off on 429 responses before retrying', async () => {
    let attempts = 0
    globalThis.fetch = (async () => {
      attempts += 1
      if (attempts === 1) return new Response('Too many requests', { status: 429 })
      return new Response(JSON.stringify({
        content: [{ type: 'tool_use', name: 'record_clinical_extraction', input: groundedPrediction }],
        usage: { input_tokens: 10, output_tokens: 20 }
      }), { status: 200 })
    }) as unknown as typeof fetch
    const result = await extractWithAnthropic(transcript, 'zero_shot', 'test-model')
    expect(attempts).toBeGreaterThan(1)
    expect(result.output).toEqual(groundedPrediction)
  })

  it('supports MOCK_LLM mode without requiring a paid Anthropic request', async () => {
    const previousMock = process.env.MOCK_LLM
    const previousKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    process.env.MOCK_LLM = 'true'

    const result = await extractWithAnthropic(transcript, 'zero_shot', 'mock')

    process.env.MOCK_LLM = previousMock
    if (previousKey) process.env.ANTHROPIC_API_KEY = previousKey

    expect(result.output).toBeTruthy()
    expect(result.attempts[0].rawOutput).toContain('MOCK_LLM')
    expect(result.attempts[0].parsedOutput).toEqual(result.output)
  })
})

describe('Resumability and idempotency', () => {
  const storePath = path.resolve('apps/server/src/.data/runs.json')

  beforeEach(async () => {
    await mkdir(path.dirname(storePath), { recursive: true })
    await writeFile(storePath, '{}', 'utf-8')
  })

  afterEach(async () => {
    await rm(path.dirname(storePath), { recursive: true, force: true })
  })

  it('persists and reloads run data from the file store', async () => {
    const store = await import('../apps/server/src/services/store.service')
    const run = await store.createRunRecord({ strategy: 'zero_shot', model: 'test', force: false }, 'hash', 'requesthash')
    await store.updateRun({ ...run, status: 'completed' })
    const reloaded = await store.loadRun(run.id)
    expect(reloaded?.status).toBe('completed')
  })

  it('deduplicates case results so resume does not double-count completed cases', async () => {
    const store = await import('../apps/server/src/services/store.service')
    const run = await store.createRunRecord({ strategy: 'zero_shot', model: 'test', force: false }, 'hash', 'requesthash')
    const caseResult = evaluateCase('01', groundedTranscript, gold, groundedPrediction, true)
    await store.addCaseResult(run.id, caseResult)
    await store.addCaseResult(run.id, { ...caseResult, hallucinations: 2 })
    const reloaded = await store.loadRun(run.id)
    expect(reloaded?.cases).toHaveLength(1)
    expect(reloaded?.cases[0].hallucinations).toBe(2)
  })
})
