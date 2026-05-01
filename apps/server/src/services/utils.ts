import { z } from 'zod'

export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[\p{P}$+<=>^`|~]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenSetScore(a: string, b: string) {
  const left = new Set(normalizeText(a).split(' ').filter(Boolean))
  const right = new Set(normalizeText(b).split(' ').filter(Boolean))
  if (!left.size || !right.size) return 0
  const intersection = new Set([...left].filter((token) => right.has(token)))
  return (2 * intersection.size) / (left.size + right.size)
}

export function exactNumericMatch(value: number | null, gold: number | null, tolerance = 0.2) {
  if (value === null || gold === null) return value === gold ? 1 : 0
  return Math.abs(value - gold) <= tolerance ? 1 : 0
}

export function normalizeMedicationText(value: string) {
  return normalizeText(value).replace(/\bmg\b/g, 'mg').replace(/\s+/g, ' ').trim()
}

export const frequencyMap: Record<string, string> = {
  bid: 'twice daily',
  tid: 'three times daily',
  qd: 'daily',
  daily: 'daily',
  'as needed': 'as needed',
  prn: 'as needed'
}

export function normalizeFrequency(value: string) {
  const token = normalizeText(value)
  return frequencyMap[token] ?? token
}

export function normalizeDose(value: string) {
  return normalizeMedicationText(value).replace(/\s+/g, ' ')
}

export function computeSetMatches<T>(predicted: T[], gold: T[], matcher: (a: T, b: T) => boolean) {
  const matches = new Set<number>()
  let tp = 0
  for (const item of predicted) {
    const index = gold.findIndex((goldItem, index) => !matches.has(index) && matcher(item, goldItem))
    if (index !== -1) {
      tp += 1
      matches.add(index)
    }
  }
  return tp
}
