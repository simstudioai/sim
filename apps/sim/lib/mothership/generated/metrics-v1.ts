// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/metrics-v1.ts
// Regenerate with `bun run contracts:sync` in the worker.

// Canonical mothership OTel metric names Sim emits. Names only: label keys and histogram
// buckets are the emitter's.

export const Metric = {
  CopilotDegradedCount: "copilot.degraded.count",
  CopilotToolCalls: "copilot.tool.calls",
  CopilotToolDuration: "copilot.tool.duration",
} as const;
