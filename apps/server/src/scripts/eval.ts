#!/usr/bin/env bun
import 'dotenv/config'
import { runToCompletion } from '../services/runner.service'
import type { PromptStrategy } from '../../../../packages/shared/src/index'

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=')
  return [key, value === undefined ? 'true' : value]
}))

const strategy = (args.strategy ?? 'zero_shot') as PromptStrategy
const model = args.model ?? 'claude-haiku-4-5-20251001'
const datasetFilter = typeof args.dataset === 'string' ? args.dataset.split(',').filter(Boolean) : undefined
const force = args.force === 'true'
const run = await runToCompletion({ strategy, model, dataset_filter: datasetFilter, force })

console.log(`Completed run ${run.id}`)
console.log(`Strategy: ${run.strategy}`)
console.log(`Model: ${run.model}`)
console.log(`Prompt hash: ${run.promptHash}`)
console.log(`Request hash: ${run.requestHash}`)
console.log(`Status: ${run.status}`)
console.log(`Cases: ${run.cases.length}`)
console.log(`Aggregate F1: ${run.fieldAggregates.aggregate.toFixed(3)}`)
console.log(`Schema failures: ${run.schemaFailureCount}`)
console.log(`Hallucinations: ${run.hallucinationCount}`)
console.log(`Cost: $${run.totalCostUsd.toFixed(4)}`)
console.table(
  Object.entries(run.fieldAggregates).map(([field, score]) => ({
    field,
    score: score.toFixed(3)
  }))
)
