import type { webhook, workflow } from '@sim/db/schema'
import type { SimEventPayloadFieldKey, SimEventType } from '@/lib/workspace-events/constants'

/** A deployed Sim-trigger block subscribed to workspace events. */
export interface SimSubscription {
  webhook: typeof webhook.$inferSelect
  workflow: typeof workflow.$inferSelect
}

/**
 * Parsed, coerced subscription configuration. Provider config values arrive as
 * raw subblock values (numbers as strings, arrays sometimes serialized), so all
 * consumers go through the parser in subscriptions.ts rather than reading
 * providerConfig directly.
 */
export interface SimSubscriptionConfig {
  eventType: SimEventType
  /** Source workflows to watch. Empty means every workflow in the workspace. */
  workflowIds: string[]
  consecutiveFailures: number
  failureRatePercent: number
  windowHours: number
  durationThresholdMs: number
  latencySpikePercent: number
  costThresholdCredits: number
  errorCountThreshold: number
  inactivityHours: number
}

/** Facts a completed run contributes to event matching and rule evaluation. */
export interface ExecutionEventContext {
  workflowId: string
  executionId: string
  status: 'success' | 'error'
  durationMs: number
  /** Run cost in dollars (the storage unit); converted to credits at the payload boundary. */
  cost: number
  finalOutput: unknown
}

/** Summary of the run behind an event, in user-facing units (cost in credits). */
export interface SimRunSummary {
  runId: string
  durationMs: number
  cost: number
  finalOutput: unknown
}

/**
 * Wire payload delivered to a Sim trigger workflow. Keys must align with
 * SIM_EVENT_PAYLOAD_FIELDS — enforced by tests on the payload builders.
 */
export type SimEventPayload = Record<SimEventPayloadFieldKey, unknown> & {
  event: SimEventType
  timestamp: string
  workflowId: string
  workflowName: string
  runId: string | null
  durationMs: number | null
  cost: number | null
  finalOutput: unknown
  triggeringRun: SimRunSummary | null
  version: number | null
}
