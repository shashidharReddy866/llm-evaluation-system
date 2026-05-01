import { tokenSetScore, exactNumericMatch, normalizeText, normalizeFrequency, normalizeDose, computeSetMatches } from './utils'
import type { ClinicalExtraction, CaseMetrics } from '../../../../packages/shared/src/index'

function fuzzyBinaryMatch(a: string, b: string) {
  return tokenSetScore(a, b) >= 0.65
}

function medicationMatch(pred: ClinicalExtraction['medications'][number], gold: ClinicalExtraction['medications'][number]) {
  const nameScore = tokenSetScore(pred.name, gold.name)
  const doseEqual = normalizeDose(pred.dose) === normalizeDose(gold.dose)
  const frequencyEqual = normalizeFrequency(pred.frequency) === normalizeFrequency(gold.frequency)
  const routeEqual = normalizeText(pred.route) === normalizeText(gold.route)
  return nameScore >= 0.7 && doseEqual && frequencyEqual && routeEqual
}

function diagnosisMatch(pred: ClinicalExtraction['diagnoses'][number], gold: ClinicalExtraction['diagnoses'][number]) {
  return tokenSetScore(pred.description, gold.description) >= 0.65
}

function planMatch(pred: string, gold: string) {
  return tokenSetScore(pred, gold) >= 0.65
}

function grounded(value: unknown, transcript: string) {
  if (value === null || value === undefined) return true
  const normalizedValue = normalizeText(String(value))
  if (!normalizedValue) return true
  if (normalizeText(transcript).includes(normalizedValue)) return true
  return tokenSetScore(normalizedValue, transcript) >= 0.65
}

export function evaluateCase(
  transcriptId: string,
  transcript: string,
  gold: ClinicalExtraction,
  prediction: ClinicalExtraction | null,
  schemaValid: boolean
): CaseMetrics {
  if (!prediction) {
    return {
      transcriptId,
      scores: {
        chief_complaint: 0,
        vitals: { bp: 0, hr: 0, temp_f: 0, spo2: 0, average: 0 },
        medications: { precision: 0, recall: 0, f1: 0 },
        diagnoses: { precision: 0, recall: 0, f1: 0 },
        plan: { precision: 0, recall: 0, f1: 0 },
        follow_up: 0,
        aggregate: 0
      },
      hallucinations: 0,
      schemaValid: false
    }
  }

  const chiefComplaintScore = tokenSetScore(gold.chief_complaint, prediction.chief_complaint)

  const vitalsScores = {
    bp: gold.vitals.bp === prediction.vitals.bp ? 1 : 0,
    hr: exactNumericMatch(prediction.vitals.hr, gold.vitals.hr, 0),
    temp_f: exactNumericMatch(prediction.vitals.temp_f, gold.vitals.temp_f, 0.2),
    spo2: exactNumericMatch(prediction.vitals.spo2, gold.vitals.spo2, 1),
    average: 0
  }
  vitalsScores.average = (vitalsScores.bp + vitalsScores.hr + vitalsScores.temp_f + vitalsScores.spo2) / 4

  const medTrue = computeSetMatches(prediction.medications, gold.medications, medicationMatch)
  const medPrecision = prediction.medications.length ? medTrue / prediction.medications.length : 1
  const medRecall = gold.medications.length ? medTrue / gold.medications.length : 1
  const medF1 = medPrecision + medRecall ? (2 * medPrecision * medRecall) / (medPrecision + medRecall) : 0

  const diagTrue = computeSetMatches(prediction.diagnoses, gold.diagnoses, diagnosisMatch)
  const diagPrecision = prediction.diagnoses.length ? diagTrue / prediction.diagnoses.length : 1
  const diagRecall = gold.diagnoses.length ? diagTrue / gold.diagnoses.length : 1
  const diagF1 = diagPrecision + diagRecall ? (2 * diagPrecision * diagRecall) / (diagPrecision + diagRecall) : 0

  const planTrue = computeSetMatches(prediction.plan, gold.plan, planMatch)
  const planPrecision = prediction.plan.length ? planTrue / prediction.plan.length : 1
  const planRecall = gold.plan.length ? planTrue / gold.plan.length : 1
  const planF1 = planPrecision + planRecall ? (2 * planPrecision * planRecall) / (planPrecision + planRecall) : 0

  const followUpScore =
    prediction.follow_up.interval_days === gold.follow_up.interval_days &&
    fuzzyBinaryMatch(prediction.follow_up.reason ?? '', gold.follow_up.reason ?? '')
      ? 1
      : 0

  const hallucinations = [
    prediction.chief_complaint,
    prediction.vitals.bp,
    prediction.vitals.hr,
    prediction.vitals.temp_f,
    prediction.vitals.spo2,
    ...prediction.medications.flatMap((med) => [med.name, med.dose, med.frequency, med.route]),
    ...prediction.diagnoses.flatMap((diag) => [diag.description, diag.icd10]),
    ...prediction.plan,
    prediction.follow_up.interval_days,
    prediction.follow_up.reason
  ].filter((value) => !grounded(value, transcript)).length

  const aggregate =
    (chiefComplaintScore + vitalsScores.average + medF1 + diagF1 + planF1 + followUpScore) / 6

  return {
    transcriptId,
    scores: {
      chief_complaint: chiefComplaintScore,
      vitals: vitalsScores,
      medications: { precision: medPrecision, recall: medRecall, f1: medF1 },
      diagnoses: { precision: diagPrecision, recall: diagRecall, f1: diagF1 },
      plan: { precision: planPrecision, recall: planRecall, f1: planF1 },
      follow_up: followUpScore,
      aggregate
    },
    hallucinations,
    schemaValid
  }
}
