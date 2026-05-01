import 'bun:dotenv'
import { Hono } from 'hono'
import { resumeRun, startRun } from './services/runner.service'
import { loadRun, listRuns } from './services/store.service'

const app = new Hono()
const prefix = '/api/v1'

app.get(`${prefix}/runs`, async (c) => {
  const runs = await listRuns()
  return c.json(runs)
})

app.post(`${prefix}/runs`, async (c) => {
  const request = await c.req.json()
  const run = await startRun(request)
  return c.json(run)
})

app.post(`${prefix}/runs/:id/resume`, async (c) => {
  try {
    const run = await resumeRun(c.req.param('id'))
    return c.json(run)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unable to resume run' }, 404)
  }
})

app.get(`${prefix}/runs/:id`, async (c) => {
  const id = c.req.param('id')
  const run = await loadRun(id)
  if (!run) return c.json({ error: 'Run not found' }, 404)
  return c.json(run)
})

app.get(`${prefix}/runs/:id/stream`, async (c) => {
  const id = c.req.param('id')
  const run = await loadRun(id)
  if (!run) return c.json({ error: 'Run not found' }, 404)
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`event: run\ndata: ${JSON.stringify(run)}\n\n`))
      controller.close()
    }
  })
  return c.body(stream, 200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache'
  })
})

app.get(`${prefix}/compare`, async (c) => {
  const leftId = c.req.query('left')
  const rightId = c.req.query('right')
  if (!leftId || !rightId) return c.json({ error: 'left and right query params are required' }, 400)
  const [left, right] = await Promise.all([loadRun(leftId), loadRun(rightId)])
  if (!left || !right) return c.json({ error: 'Run not found' }, 404)
  const fields = ['chief_complaint', 'vitals', 'medications', 'diagnoses', 'plan', 'follow_up', 'aggregate'] as const
  return c.json({
    left,
    right,
    deltas: fields.map((field) => {
      const delta = right.fieldAggregates[field] - left.fieldAggregates[field]
      return {
        field,
        left: left.fieldAggregates[field],
        right: right.fieldAggregates[field],
        delta,
        winner: Math.abs(delta) < 0.001 ? 'tie' : delta > 0 ? right.id : left.id
      }
    })
  })
})

Bun.serve({
  port: 8787,
  fetch: app.fetch
})
