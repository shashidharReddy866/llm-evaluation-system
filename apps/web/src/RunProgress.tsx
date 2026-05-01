"use client";

/**
 * apps/web/src/components/RunProgress.tsx
 *
 * Drop this into any page where you want to show live eval progress.
 * It connects via SSE and shows a live case-by-case progress table.
 *
 * Usage:
 *   <RunProgress runId={newRunId} totalCases={50} />
 */
import { stream } from "hono/streaming";
import { useRunStream } from "../hooks/useRunStream";

interface Props {
  runId: string;
  totalCases?: number;
}

const FIELDS = ["chief_complaint", "vitals", "medications", "diagnoses", "plan", "follow_up"];

function scoreColor(score: number): string {
  if (score >= 0.85) return "text-green-600";
  if (score >= 0.65) return "text-yellow-600";
  return "text-red-500";
}

export function RunProgress({ runId, totalCases = 50 }: Props) {
  const { events, completedCount, isComplete, aggregateF1, error } =
    useRunStream(runId);

  const caseEvents = events.filter((e) => e.type === "case_complete") as Extract<
    typeof events[number],
    { type: "case_complete" }
  >[];

  const pct = Math.round((completedCount / totalCases) * 100);

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-sm text-gray-500 mb-1">
          <span>
            {completedCount} / {totalCases} cases
          </span>
          <span>
            {isComplete ? (
              <span className="text-green-600 font-semibold">
                ✓ Complete — Aggregate F1:{" "}
                {aggregateF1 != null
                  ? `${(aggregateF1 * 100).toFixed(1)}%`
                  : "—"}
              </span>
            ) : (
              <span className="animate-pulse text-blue-500">Running…</span>
            )}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded h-2">
          <div
            className={`h-2 rounded transition-all duration-300 ${
              isComplete ? "bg-green-500" : "bg-blue-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {error && (
        <div className="text-red-600 text-sm bg-red-50 rounded px-3 py-2">
          ⚠ {error}
        </div>
      )}

      {/* Live case table */}
      {caseEvents.length > 0 && (
        <div className="overflow-auto max-h-96 border border-gray-200 rounded">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-2 text-gray-500">Case</th>
                {FIELDS.map((f) => (
                  <th key={f} className="px-2 py-2 text-gray-500 text-center capitalize">
                    {f.replace("_", " ")}
                  </th>
                ))}
                <th className="px-2 py-2 text-gray-500 text-center">Tries</th>
                <th className="px-2 py-2 text-gray-500 text-center">🔵</th>
              </tr>
            </thead>
            <tbody>
              {[...caseEvents].reverse().map((e) => (
                <tr key={e.transcriptId} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-1.5 font-mono text-gray-700">
                    {e.transcriptId}
                  </td>
                  {FIELDS.map((f) => {
                    const score = e.scores?.[f] ?? null;
                    return (
                      <td key={f} className={`px-2 py-1.5 text-center font-mono ${score != null ? scoreColor(score) : "text-gray-300"}`}>
                        {score != null ? (score * 100).toFixed(0) + "%" : "—"}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-center text-gray-500">
                    {e.attempt}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {e.cached ? (
                      <span title="cached" className="text-gray-400">♻</span>
                    ) : e.hallucinationCount ? (
                      <span title={`${e.hallucinationCount} hallucination(s)`} className="text-orange-400">⚠</span>
                    ) : (
                      <span className="text-green-400">✓</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
