"use client";

import { useEffect, useState } from "react";

interface RunMeta {
  id: string;
  strategy: string;
  model: string;
  status: string;
  createdAt: string;
  aggregateF1: number | null;
  totalCost: number | null;
  totalTokens: number | null;
  caseCount: number;
}

interface FieldScores {
  chief_complaint: number;
  vitals: number;
  medications: number;
  diagnoses: number;
  plan: number;
  follow_up: number;
}

interface RunDetail {
  meta: RunMeta;
  fieldAverages: FieldScores;
  hallucinationCount: number;
  schemaFailureCount: number;
  cacheReadTokens: number;
}

const FIELDS: (keyof FieldScores)[] = [
  "chief_complaint",
  "vitals",
  "medications",
  "diagnoses",
  "plan",
  "follow_up",
];

const FIELD_LABELS: Record<keyof FieldScores, string> = {
  chief_complaint: "Chief Complaint",
  vitals: "Vitals",
  medications: "Medications",
  diagnoses: "Diagnoses",
  plan: "Plan",
  follow_up: "Follow-up",
};

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 rounded h-2">
        <div
          className={`h-2 rounded ${color}`}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="text-xs w-10 text-right font-mono">
        {(value * 100).toFixed(1)}%
      </span>
    </div>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  if (Math.abs(delta) < 0.001) {
    return <span className="text-gray-400 text-xs">—</span>;
  }
  const positive = delta > 0;
  return (
    <span
      className={`text-xs font-bold px-1 py-0.5 rounded ${
        positive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
      }`}
    >
      {positive ? "+" : ""}
      {(delta * 100).toFixed(1)}%
    </span>
  );
}

function WinnerBadge({ winner }: { winner: "A" | "B" | "tie" }) {
  if (winner === "tie")
    return <span className="text-xs text-gray-400">Tie</span>;
  return (
    <span
      className={`text-xs font-bold px-2 py-0.5 rounded ${
        winner === "A"
          ? "bg-blue-100 text-blue-700"
          : "bg-purple-100 text-purple-700"
      }`}
    >
      Run {winner} wins
    </span>
  );
}

export default function ComparePage() {
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [runAId, setRunAId] = useState<string>("");
  const [runBId, setRunBId] = useState<string>("");
  const [runA, setRunA] = useState<RunDetail | null>(null);
  const [runB, setRunB] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/runs")
      .then((r) => r.json())
      .then((data) => setRuns(data.runs ?? []))
      .catch(() => setError("Failed to load runs"));
  }, []);

  async function loadRunDetail(id: string): Promise<RunDetail | null> {
    const res = await fetch(`/api/v1/runs/${id}`);
    if (!res.ok) return null;
    return res.json();
  }

  async function handleCompare() {
    if (!runAId || !runBId || runAId === runBId) return;
    setLoading(true);
    setError(null);
    try {
      const [a, b] = await Promise.all([
        loadRunDetail(runAId),
        loadRunDetail(runBId),
      ]);
      setRunA(a);
      setRunB(b);
    } catch {
      setError("Failed to load run details");
    } finally {
      setLoading(false);
    }
  }

  const overallWinner = (() => {
    if (!runA || !runB) return null;
    const aF1 = runA.meta.aggregateF1 ?? 0;
    const bF1 = runB.meta.aggregateF1 ?? 0;
    if (Math.abs(aF1 - bF1) < 0.001) return "tie" as const;
    return aF1 > bF1 ? ("A" as const) : ("B" as const);
  })();

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Compare Runs</h1>
        <p className="text-sm text-gray-500 mt-1">
          Pick any two runs to see per-field score deltas and which strategy wins
          on each field.
        </p>
      </div>

      {/* Run selectors */}
      <div className="grid grid-cols-2 gap-4">
        {(["A", "B"] as const).map((label) => {
          const val = label === "A" ? runAId : runBId;
          const setter = label === "A" ? setRunAId : setRunBId;
          const other = label === "A" ? runBId : runAId;
          return (
            <div key={label}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Run {label}
              </label>
              <select
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={val}
                onChange={(e) => setter(e.target.value)}
              >
                <option value="">— select a run —</option>
                {runs
                  .filter((r) => r.id !== other)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.strategy} / {r.model} —{" "}
                      {r.aggregateF1 != null
                        ? `F1 ${(r.aggregateF1 * 100).toFixed(1)}%`
                        : r.status}{" "}
                      — {new Date(r.createdAt).toLocaleDateString()}
                    </option>
                  ))}
              </select>
            </div>
          );
        })}
      </div>

      <button
        onClick={handleCompare}
        disabled={!runAId || !runBId || runAId === runBId || loading}
        className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium disabled:opacity-40 hover:bg-blue-700 transition"
      >
        {loading ? "Loading…" : "Compare"}
      </button>

      {error && (
        <div className="text-red-600 text-sm bg-red-50 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Results */}
      {runA && runB && (
        <div className="space-y-6">
          {/* Header summary */}
          <div className="grid grid-cols-3 gap-4">
            {/* Run A card */}
            <div className="border border-blue-200 rounded-lg p-4 bg-blue-50">
              <div className="text-xs text-blue-500 font-medium uppercase tracking-wide mb-1">
                Run A
              </div>
              <div className="text-lg font-bold text-blue-900">
                {runA.meta.strategy}
              </div>
              <div className="text-xs text-blue-600">{runA.meta.model}</div>
              <div className="mt-2 text-2xl font-mono font-bold text-blue-700">
                {runA.meta.aggregateF1 != null
                  ? `${(runA.meta.aggregateF1 * 100).toFixed(1)}%`
                  : "—"}
              </div>
              <div className="text-xs text-gray-500">Aggregate F1</div>
              <div className="mt-2 text-xs text-gray-500 space-y-0.5">
                <div>Hallucinations: {runA.hallucinationCount}</div>
                <div>Schema failures: {runA.schemaFailureCount}</div>
                <div>Cache hits: {runA.cacheReadTokens.toLocaleString()} tok</div>
                <div>
                  Cost: $
                  {runA.meta.totalCost != null
                    ? runA.meta.totalCost.toFixed(4)
                    : "—"}
                </div>
              </div>
            </div>

            {/* Overall verdict */}
            <div className="border border-gray-200 rounded-lg p-4 flex flex-col items-center justify-center text-center bg-white">
              <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">
                Overall Winner
              </div>
              {overallWinner === "tie" ? (
                <div className="text-gray-500 font-semibold">Tie</div>
              ) : (
                <>
                  <div
                    className={`text-3xl font-black ${
                      overallWinner === "A"
                        ? "text-blue-600"
                        : "text-purple-600"
                    }`}
                  >
                    Run {overallWinner}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {overallWinner === "A"
                      ? runA.meta.strategy
                      : runB.meta.strategy}{" "}
                    strategy
                  </div>
                  <div className="mt-2 text-sm font-mono text-gray-600">
                    Δ{" "}
                    {Math.abs(
                      ((runA.meta.aggregateF1 ?? 0) -
                        (runB.meta.aggregateF1 ?? 0)) *
                        100
                    ).toFixed(1)}
                    %
                  </div>
                </>
              )}
            </div>

            {/* Run B card */}
            <div className="border border-purple-200 rounded-lg p-4 bg-purple-50">
              <div className="text-xs text-purple-500 font-medium uppercase tracking-wide mb-1">
                Run B
              </div>
              <div className="text-lg font-bold text-purple-900">
                {runB.meta.strategy}
              </div>
              <div className="text-xs text-purple-600">{runB.meta.model}</div>
              <div className="mt-2 text-2xl font-mono font-bold text-purple-700">
                {runB.meta.aggregateF1 != null
                  ? `${(runB.meta.aggregateF1 * 100).toFixed(1)}%`
                  : "—"}
              </div>
              <div className="text-xs text-gray-500">Aggregate F1</div>
              <div className="mt-2 text-xs text-gray-500 space-y-0.5">
                <div>Hallucinations: {runB.hallucinationCount}</div>
                <div>Schema failures: {runB.schemaFailureCount}</div>
                <div>Cache hits: {runB.cacheReadTokens.toLocaleString()} tok</div>
                <div>
                  Cost: $
                  {runB.meta.totalCost != null
                    ? runB.meta.totalCost.toFixed(4)
                    : "—"}
                </div>
              </div>
            </div>
          </div>

          {/* Per-field breakdown */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-700">
                Per-Field Score Breakdown
              </h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium w-36">
                    Field
                  </th>
                  <th className="px-4 py-2 text-xs text-blue-500 font-medium text-center">
                    Run A ({runA.meta.strategy})
                  </th>
                  <th className="px-4 py-2 text-xs text-purple-500 font-medium text-center">
                    Run B ({runB.meta.strategy})
                  </th>
                  <th className="px-4 py-2 text-xs text-gray-500 font-medium text-center">
                    Delta (A→B)
                  </th>
                  <th className="px-4 py-2 text-xs text-gray-500 font-medium text-center">
                    Winner
                  </th>
                </tr>
              </thead>
              <tbody>
                {FIELDS.map((field, idx) => {
                  const aScore = runA.fieldAverages[field] ?? 0;
                  const bScore = runB.fieldAverages[field] ?? 0;
                  const delta = bScore - aScore;
                  const winner: "A" | "B" | "tie" =
                    Math.abs(delta) < 0.001
                      ? "tie"
                      : delta < 0
                      ? "A"
                      : "B";
                  return (
                    <tr
                      key={field}
                      className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                    >
                      <td className="px-4 py-3 font-medium text-gray-700">
                        {FIELD_LABELS[field]}
                      </td>
                      <td className="px-4 py-3">
                        <ScoreBar value={aScore} color="bg-blue-400" />
                      </td>
                      <td className="px-4 py-3">
                        <ScoreBar value={bScore} color="bg-purple-400" />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <DeltaBadge delta={delta} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <WinnerBadge winner={winner} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Reliability comparison */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-700">
                Reliability Metrics
              </h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">
                    Metric
                  </th>
                  <th className="px-4 py-2 text-xs text-blue-500 font-medium text-center">
                    Run A
                  </th>
                  <th className="px-4 py-2 text-xs text-purple-500 font-medium text-center">
                    Run B
                  </th>
                  <th className="px-4 py-2 text-xs text-gray-500 font-medium text-center">
                    Better
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: "Hallucinations",
                    a: runA.hallucinationCount,
                    b: runB.hallucinationCount,
                    lowerBetter: true,
                  },
                  {
                    label: "Schema Failures",
                    a: runA.schemaFailureCount,
                    b: runB.schemaFailureCount,
                    lowerBetter: true,
                  },
                  {
                    label: "Cache Read Tokens",
                    a: runA.cacheReadTokens,
                    b: runB.cacheReadTokens,
                    lowerBetter: false,
                  },
                ].map(({ label, a, b, lowerBetter }, idx) => {
                  const aBetter = lowerBetter ? a < b : a > b;
                  const bBetter = lowerBetter ? b < a : b > a;
                  return (
                    <tr
                      key={label}
                      className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                    >
                      <td className="px-4 py-3 font-medium text-gray-700">
                        {label}
                      </td>
                      <td className="px-4 py-3 text-center font-mono">
                        {typeof a === "number" ? a.toLocaleString() : a}
                      </td>
                      <td className="px-4 py-3 text-center font-mono">
                        {typeof b === "number" ? b.toLocaleString() : b}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {aBetter ? (
                          <WinnerBadge winner="A" />
                        ) : bBetter ? (
                          <WinnerBadge winner="B" />
                        ) : (
                          <WinnerBadge winner="tie" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
