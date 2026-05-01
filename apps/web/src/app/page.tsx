import Link from 'next/link'
import type { RunResult } from '../../../../packages/shared/src/index'

async function fetchRuns(): Promise<{ runs: RunResult[]; error: string | null }> {
  try {
    const res = await fetch('http://localhost:8787/api/v1/runs', { cache: 'no-store' })
    if (!res.ok) return { runs: [], error: `API returned ${res.status}` }
    return { runs: (await res.json()) as RunResult[], error: null }
  } catch (error) {
    return {
      runs: [],
      error: error instanceof Error ? error.message : 'Unable to reach API server'
    }
  }
}

export default async function Page() {
  const { runs, error } = await fetchRuns()
  const completedRuns = runs.filter((run: any) => run.status === 'completed')
  const [left, right] = completedRuns.slice(-2)
  const fields = ['chief_complaint', 'vitals', 'medications', 'diagnoses', 'plan', 'follow_up', 'aggregate'] as const
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>HEALOSBENCH runs</h1>
      {error ? (
        <p style={{ color: '#b00020' }}>API server is not reachable on localhost:8787. Start it with: $env:MOCK_LLM='true'; bun run dev:server</p>
      ) : null}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
        <thead>
          <tr>
            <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Run</th>
            <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Strategy</th>
            <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Model</th>
            <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Status</th>
            <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Aggregate</th>
            <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Cost</th>
            <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Cache read</th>
            <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Detail</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run: any) => (
            <tr key={run.id}>
              <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{run.id.slice(0, 8)}</td>
              <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{run.strategy}</td>
              <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{run.model}</td>
              <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{run.status}</td>
              <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{(run.fieldAggregates?.aggregate ?? 0).toFixed(3)}</td>
              <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>${run.totalCostUsd.toFixed(3)}</td>
              <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{run.totalTokens?.cacheRead ?? 0}</td>
              <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}><Link href={`/run/${run.id}`}>View</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
      {left && right ? (
        <>
          <h2 style={{ marginTop: '2rem' }}>Compare latest completed runs</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Field</th>
                <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{left.strategy}</th>
                <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{right.strategy}</th>
                <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Delta</th>
                <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Winner</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => {
                const leftScore = left.fieldAggregates?.[field] ?? 0
                const rightScore = right.fieldAggregates?.[field] ?? 0
                const delta = rightScore - leftScore
                const winner = Math.abs(delta) < 0.001 ? 'tie' : delta > 0 ? right.strategy : left.strategy
                return (
                  <tr key={field}>
                    <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{field}</td>
                    <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{leftScore.toFixed(3)}</td>
                    <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{rightScore.toFixed(3)}</td>
                    <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{delta.toFixed(3)}</td>
                    <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{winner}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      ) : null}
    </main>
  )
}
