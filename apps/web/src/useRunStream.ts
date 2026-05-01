/**
 * apps/web/src/hooks/useRunStream.ts
 *
 * Connects to GET /api/v1/runs/:id/stream and surfaces progress events
 * as React state — no polling needed.
 *
 * Usage:
 *   const { events, isComplete, error } = useRunStream(runId);
 */

import { useEffect, useRef, useState } from "react";

export type RunStreamEvent =
  | {
      type: "case_complete";
      transcriptId: string;
      scores: Record<string, number>;
      attempt: number;
      cached: boolean;
      hallucinationCount?: number;
    }
  | { type: "case_error"; transcriptId: string; error: string }
  | {
      type: "run_complete";
      aggregateF1: number;
      totalCost: number;
      totalTokens: number;
      wallTimeMs: number;
    }
  | { type: "error"; message: string };

interface UseRunStreamResult {
  events: RunStreamEvent[];
  completedCount: number;
  isComplete: boolean;
  aggregateF1: number | null;
  error: string | null;
}

export function useRunStream(runId: string | null): UseRunStreamResult {
  const [events, setEvents] = useState<RunStreamEvent[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [aggregateF1, setAggregateF1] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!runId) return;

    // Reset on new run
    setEvents([]);
    setIsComplete(false);
    setAggregateF1(null);
    setError(null);

    const es = new EventSource(`/api/v1/runs/${runId}/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      if (!e.data || e.data.startsWith(":")) return; // skip keep-alive pings

      let event: RunStreamEvent;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }

      setEvents((prev) => [...prev, event]);

      if (event.type === "run_complete") {
        setIsComplete(true);
        setAggregateF1(event.aggregateF1);
        es.close();
      }

      if (event.type === "error") {
        setError(event.message);
        es.close();
      }
    };

    es.onerror = () => {
      setError("Connection to server lost. The run may still be processing.");
      es.close();
    };

    return () => {
      es.close();
    };
  }, [runId]);

  const completedCount = events.filter((e) => e.type === "case_complete").length;

  return { events, completedCount, isComplete, aggregateF1, error };
}
