import type { PromptStrategy } from '../../shared/src/index'
import { buildPrompt, promptVersionHash } from './strategies'
import { schema } from '../../shared/src/index'
import Ajv from 'ajv'

export type AnthropicResponse = {
  attempt: number
  validationErrors: string[]
  parsedOutput: unknown | null
  rawOutput: string
  cacheReadTokens: number
  cacheWriteTokens: number
  requestTokens: number
  responseTokens: number
}

export async function extractWithAnthropic(
  transcript: string,
  strategy: PromptStrategy,
  model: string,
  maxAttempts = 3
): Promise<{ output: unknown | null; attempts: AnthropicResponse[]; promptHash: string }> {
  const prompt = buildPrompt(strategy, transcript)
  const promptHash = await promptVersionHash(strategy)

  if (process.env.MOCK_LLM === 'true') {
    return mockExtraction(transcript, strategy, prompt, promptHash)
  }

  const attempts: AnthropicResponse[] = []
  let feedback: string | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await callAnthropic({ model, prompt, feedback, attempt })
    const validation = validateSchema(response.parsedOutput)
    response.validationErrors = validation.errors
    attempts.push(response)

    if (validation.valid && response.parsedOutput) {
      return { output: response.parsedOutput, attempts, promptHash }
    }

    feedback = [
      'The previous tool input failed JSON Schema validation.',
      'Correct only the structured extraction and call the tool again.',
      `Validation errors: ${validation.errors.join('; ') || 'No tool input was provided.'}`
    ].join('\n')
  }

  return { output: null, attempts, promptHash }
}

function mockExtraction(
  transcript: string,
  strategy: PromptStrategy,
  prompt: string,
  promptHash: string
): { output: unknown | null; attempts: AnthropicResponse[]; promptHash: string } {
  const output = buildMockClinicalExtraction(transcript, strategy)
  return {
    output,
    promptHash,
    attempts: [
      {
        attempt: 1,
        validationErrors: [],
        parsedOutput: output,
        rawOutput: JSON.stringify({
          provider: 'mock',
          mode: 'MOCK_LLM',
          strategy,
          output
        }),
        cacheReadTokens: strategy === 'few_shot' ? 120 : 60,
        cacheWriteTokens: 0,
        requestTokens: Math.ceil(prompt.length / 4),
        responseTokens: Math.ceil(JSON.stringify(output).length / 4)
      }
    ]
  }
}

function buildMockClinicalExtraction(transcript: string, strategy: PromptStrategy) {
  const lower = transcript.toLowerCase()
  const vitals = extractMockVitals(transcript)
  const followUpMatch = lower.match(/follow up in (\d+) days?(?: if ([^.]+)| for ([^.]+))?/)
  const medication = extractMockMedication(transcript)
  const diagnosisMatch = transcript.match(/Assessment:\s*([^.]+)\./i)
  const planMatch = transcript.match(/Plan:\s*([^.]+)/i)
  const plan = planMatch
    ? planMatch[1].split(',').map((item) => item.trim()).filter(Boolean)
    : []

  return {
    chief_complaint: extractMockChiefComplaint(transcript),
    vitals,
    medications: medication ? [medication] : [],
    diagnoses: diagnosisMatch ? [{ description: diagnosisMatch[1].trim(), icd10: null }] : [],
    plan,
    follow_up: {
      interval_days: followUpMatch ? Number(followUpMatch[1]) : null,
      reason: followUpMatch?.[2]?.trim() ?? followUpMatch?.[3]?.trim() ?? null
    }
  }
}

function extractMockChiefComplaint(transcript: string) {
  const presents = transcript.match(/Patient presents with (.+?)(?:\.| that | and |,)/i)
  if (presents?.[1]) return presents[1].trim()

  const complains = transcript.match(/(?:complains of|reports|with) (.+?)(?:\.| and |,)/i)
  if (complains?.[1]) return complains[1].trim()

  return 'unspecified complaint'
}

function extractMockVitals(transcript: string) {
  const bp = transcript.match(/\b(\d{2,3}\/\d{2,3})\b/)
  const hr = transcript.match(/\b(?:pulse|hr|heart rate)?\s*(\d{2,3})\s*(?:bpm|, pulse)\b/i)
  const temp = transcript.match(/\b(?:temperature|temp)?\s*(\d{2,3}(?:\.\d+)?)\s*F\b/i)
  const spo2 = transcript.match(/\b(?:oxygen saturation|spo2)?\s*(\d{2,3})%\s*(?:SpO2|on room air)?\b/i)

  return {
    bp: bp?.[1] ?? null,
    hr: hr ? Number(hr[1]) : null,
    temp_f: temp ? Number(temp[1]) : null,
    spo2: spo2 ? Number(spo2[1]) : null
  }
}

function extractMockMedication(transcript: string) {
  const startMed = transcript.match(/start\s+([a-zA-Z][a-zA-Z -]+?)\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml))\s+([^,.]+)/i)
  if (startMed) {
    return {
      name: startMed[1].trim(),
      dose: startMed[2].replace(/\s+/g, ' ').trim(),
      frequency: startMed[3].trim(),
      route: 'oral'
    }
  }

  const takesMed = transcript.match(/(?:takes|taking|on)\s+([a-zA-Z][a-zA-Z -]+?)\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml))?\s*(daily|twice daily|bid|tid|as needed|occasionally)?/i)
  if (!takesMed?.[1]) return null

  return {
    name: takesMed[1].trim(),
    dose: takesMed[2]?.replace(/\s+/g, ' ').trim() ?? '',
    frequency: takesMed[3]?.trim() ?? '',
    route: 'oral'
  }
}

async function callAnthropic({
  model,
  prompt,
  feedback,
  attempt
}: {
  model: string
  prompt: string
  feedback: string | null
  attempt: number
}): Promise<AnthropicResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required for Anthropic requests')
  }

  const url = 'https://api.anthropic.com/v1/messages'
  const body = {
    model,
    max_tokens: 1200,
    temperature: 0.0,
    system: [
      {
        type: 'text',
        text: 'You are a clinical extraction assistant. Extract only facts supported by the transcript. Use the provided tool exactly once with schema-conformant values.',
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: feedback ? `${prompt}\n\n${feedback}` : prompt,
            cache_control: { type: 'ephemeral' }
          }
        ]
      }
    ],
    tools: [
      {
        name: 'record_clinical_extraction',
        description: 'Record the structured clinical extraction for this transcript.',
        input_schema: schema
      }
    ],
    tool_choice: { type: 'tool', name: 'record_clinical_extraction' },
    metadata: { source: 'healosbench' }
  }

  let retry = 0
  while (true) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31'
      },
      body: JSON.stringify(body)
    })

    if (res.status === 429 && retry < 3) {
      const delay = Math.min(1000 * 2 ** retry, 5000)
      await new Promise((resolve) => setTimeout(resolve, delay))
      retry += 1
      continue
    }

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Anthropic request failed ${res.status}: ${text}`)
    }

    const data = (await res.json()) as any
    const toolUse = Array.isArray(data.content)
      ? data.content.find((item: any) => item?.type === 'tool_use' && item?.name === 'record_clinical_extraction')
      : null
    const parsedOutput = toolUse?.input ?? null
    const rawOutput = JSON.stringify(data)
    const usage = data.usage ?? {}
    const cacheReadTokens = usage.cache_read_input_tokens ?? data.cache_read_input_tokens ?? 0
    const cacheWriteTokens = usage.cache_creation_input_tokens ?? data.cache_write_input_tokens ?? 0
    const requestTokens = usage.input_tokens ?? data.request_tokens ?? 0
    const responseTokens = usage.output_tokens ?? data.response_tokens ?? 0

    return {
      attempt,
      validationErrors: [],
      parsedOutput,
      rawOutput,
      cacheReadTokens,
      cacheWriteTokens,
      requestTokens,
      responseTokens
    }
  }
}

const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(schema)

function validateSchema(candidate: unknown): { valid: boolean; errors: string[] } {
  try {
    const valid = validate(candidate) as boolean
    return {
      valid,
      errors: valid
        ? []
        : (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
    }
  } catch {
    return { valid: false, errors: ['schema validator threw unexpectedly'] }
  }
}
