import { drizzle } from 'drizzle-orm'
import { pgTable, serial, text, varchar, integer, json, timestamp } from 'drizzle-orm/pg-core'
import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL

export const client = databaseUrl ? drizzle(new Pool({ connectionString: databaseUrl })) : null

export const runs = pgTable('runs', {
  id: varchar('id', { length: 36 }).primaryKey(),
  strategy: varchar('strategy', { length: 32 }).notNull(),
  model: varchar('model', { length: 128 }).notNull(),
  prompt_hash: varchar('prompt_hash', { length: 128 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  completed_at: timestamp('completed_at').default(null),
  total_cost_usd: text('total_cost_usd').default('0'),
  total_wall_time_ms: integer('total_wall_time_ms').default(0),
  request_hash: varchar('request_hash', { length: 128 }).notNull()
})

export const cases = pgTable('cases', {
  id: serial('id').primaryKey(),
  run_id: varchar('run_id', { length: 36 }).notNull(),
  transcript_id: varchar('transcript_id', { length: 64 }).notNull(),
  scores: json('scores').notNull(),
  hallucinations: integer('hallucinations').notNull(),
  schema_valid: integer('schema_valid').notNull(),
  tokens: json('tokens').notNull(),
  attempt_trace: json('attempt_trace').notNull()
})
