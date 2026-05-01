import { z } from 'zod'

const serverSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().url().optional()
})

export const env = serverSchema.parse(process.env)
