import Link from 'next/link'
import type { RunResult } from '../../../../../../packages/shared/src/index'

async function fetchRun(id: string): Promise<{ run: RunResult | null; error: string | null }> {
  try {
    const res = await fetch(`http://localhost:8787/api/v1/runs/${id}`, { cache: 'no-store' })
    if (!res.ok) return { run: null, error: `API returned ${res.status}` }
    return { run: (await res.json()) as RunResult, error: null }
  } catch (error) {
    return {
      run: null,
      error: error instanceof Error ? error.message : 'Unable to reach API server'
    }
  }
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { run, error } = await fetchRun(id)
  if (!run) {
    return (
      <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
        <Link href="/">Back to runs</Link>
        <h1>Run unavailable</h1>
        <p style={{ color: '#b00020' }}>{error ?? 'Run not found'}</p>
        <p>Start the API server with: $env:MOCK_LLM='true'; bun run dev:server</p>
      </main>
    )
  }
  const firstCase = run.cases?.[0]

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <Link href="/">Back to runs</Link>
      <h1>Run {run.id}</h1>
      <p>Strategy: {run.strategy}</p>
      <p>Model: {run.model}</p>
      <p>Status: {run.status}</p>
      <p>Cost: ${run.totalCostUsd.toFixed(3)}</p>
      <p>Prompt hash: {run.promptHash}</p>
      <p>Cache read tokens: {run.totalTokens?.cacheRead ?? 0}</p>
      <p>Schema failures: {run.schemaFailureCount ?? 0}</p>
      <p>Hallucinations: {run.hallucinationCount ?? 0}</p>

      <h2>Cases</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
        <thead>
          <tr>
            <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Transcript</th>
            <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Aggregate</th>
            <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Hallucinations</th>
            <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Schema valid</th>
            <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Attempts</th>
          </tr>
        </thead>
        <tbody>
          {run.cases.map((caseItem: any) => (
            <tr key={caseItem.transcriptId}>
              <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{caseItem.transcriptId}</td>
              <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{caseItem.scores.aggregate.toFixed(3)}</td>
              <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{caseItem.hallucinations}</td>
              <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{caseItem.schemaValid ? 'yes' : 'no'}</td>
              <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{caseItem.attempts?.length ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {firstCase ? (
        <>
          <h2 style={{ marginTop: '2rem' }}>First case inspection</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
            <section>
              <h3>Gold JSON</h3>
              <pre style={{ overflow: 'auto', background: '#f7f7f7', padding: '1rem' }}>{JSON.stringify(firstCase.gold, null, 2)}</pre>
            </section>
            <section>
              <h3>Prediction JSON</h3>
              <pre style={{ overflow: 'auto', background: '#f7f7f7', padding: '1rem' }}>{JSON.stringify(firstCase.prediction, null, 2)}</pre>
            </section>
          </div>
          <h3>LLM trace</h3>
          <pre style={{ overflow: 'auto', background: '#f7f7f7', padding: '1rem' }}>{JSON.stringify(firstCase.attempts, null, 2)}</pre>
        </>
      ) : null}
    </main>
  )
}
