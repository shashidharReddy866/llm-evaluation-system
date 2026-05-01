import Ajv from 'ajv'
import { extractWithAnthropic } from '../../../../packages/llm/src/index'
import { schema } from '../../../../packages/shared/src/index'
import type { ClinicalExtraction, ExtractionAttempt, PromptStrategy } from '../../../../packages/shared/src/index'

const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(schema)

export type ExtractionResult = {
  prediction: ClinicalExtraction | null
  attempts: ExtractionAttempt[]
  promptHash: string
  schemaValid: boolean
}

export async function extractTranscript(
  transcript: string,
  strategy: PromptStrategy,
  model: string
): Promise<ExtractionResult> {
  const result = await extractWithAnthropic(transcript, strategy, model)

  if (result.output && validate(result.output)) {
    return {
      prediction: result.output as ClinicalExtraction,
      attempts: result.attempts,
      promptHash: result.promptHash,
      schemaValid: true
    }
  }

  return {
    prediction: null,
    attempts: result.attempts,
    promptHash: result.promptHash,
    schemaValid: false
  }
}
