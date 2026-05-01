import schemaJson from '../../../data/schema.json' assert { type: 'json' }

export type PromptStrategy = 'zero_shot' | 'few_shot' | 'cot'

export type VitalSet = {
  bp: string | null
  hr: number | null
  temp_f: number | null
  spo2: number | null
}

export type Medication = {
  name: string
  dose: string
  frequency: string
  route: string
}

export type Diagnosis = {
  description: string
  icd10: string | null
}

export type FollowUp = {
  interval_days: number | null
  reason: string | null
}

export type ClinicalExtraction = {
  chief_complaint: string
  vitals: VitalSet
  medications: Medication[]
  diagnoses: Diagnosis[]
  plan: string[]
  follow_up: FollowUp
}

export type RunRequest = {
  strategy: PromptStrategy
  model: string
  dataset_filter?: string[]
  force?: boolean
}

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed'

export type CaseMetrics = {
  transcriptId: string
  prediction?: ClinicalExtraction | null
  gold?: ClinicalExtraction
  attempts?: ExtractionAttempt[]
  tokens?: TokenUsage
  scores: {
    chief_complaint: number
    vitals: {
      bp: number
      hr: number
      temp_f: number
      spo2: number
      average: number
    }
    medications: {
      precision: number
      recall: number
      f1: number
    }
    diagnoses: {
      precision: number
      recall: number
      f1: number
    }
    plan: {
      precision: number
      recall: number
      f1: number
    }
    follow_up: number
    aggregate: number
  }
  hallucinations: number
  schemaValid: boolean
}

export type TokenUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type ExtractionAttempt = {
  attempt: number
  validationErrors: string[]
  parsedOutput: unknown | null
  rawOutput: string
  cacheReadTokens: number
  cacheWriteTokens: number
  requestTokens: number
  responseTokens: number
}

export type FieldAggregates = {
  chief_complaint: number
  vitals: number
  medications: number
  diagnoses: number
  plan: number
  follow_up: number
  aggregate: number
}

export type RunResult = {
  id: string
  strategy: PromptStrategy
  model: string
  promptHash: string
  requestHash: string
  datasetFilter?: string[]
  status: RunStatus
  createdAt: string
  completedAt?: string
  totalCostUsd: number
  totalWallTimeMs: number
  schemaFailureCount: number
  hallucinationCount: number
  fieldAggregates: FieldAggregates
  totalTokens: TokenUsage
  cases: CaseMetrics[]
}

export const schema = schemaJson as unknown as Record<string, unknown>
