import type { PromptStrategy } from '../../shared/src/index'

const fewShotExamples = [
  {
    input: `Patient complains of mild abdominal pain and nausea. Vital signs are 120/78, 82 bpm, 98.4 F, 99% SpO2. She takes lisinopril daily. Assessment: gastritis. Plan: start ondansetron 4 mg every 8 hours as needed. Follow up in 3 days for recheck.`,
    output: {
      chief_complaint: 'Abdominal pain with nausea',
      vitals: { bp: '120/78', hr: 82, temp_f: 98.4, spo2: 99 },
      medications: [
        { name: 'ondansetron', dose: '4 mg', frequency: 'every 8 hours as needed', route: 'oral' }
      ],
      diagnoses: [{ description: 'gastritis', icd10: null }],
      plan: ['start ondansetron', 'follow up in 3 days for recheck'],
      follow_up: { interval_days: 3, reason: 'reevaluate nausea and abdominal pain' }
    }
  }
]

const systemPrompt = `You are a clinical extraction assistant. Analyze the transcript and return only valid JSON that conforms to the schema exactly. Do not add explanations, markup, or markdown fences.`

export function buildPrompt(strategy: PromptStrategy, transcript: string) {
  const base = [`${systemPrompt}\n\nTranscript:\n${transcript}`]

  if (strategy === 'few_shot') {
    base.unshift(
      `Example:\n${fewShotExamples[0].input}\nExpected JSON:\n${JSON.stringify(fewShotExamples[0].output, null, 2)}\n\n`
    )
  }

  if (strategy === 'cot') {
    base.unshift('Think through the transcript step by step, identify each extraction component, then output final JSON.')
  }

  return base.join('\n')
}

export function promptVersionHash(strategy: PromptStrategy) {
  const text = `${strategy}:${systemPrompt}:${fewShotExamples.map((example) => example.input + JSON.stringify(example.output)).join('\n')}`
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then((hash) => {
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
  })
}
