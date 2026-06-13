import { truncate } from '@sim/utils/string'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  SIM_FINAL_OUTPUT_MAX_BYTES,
  type SimEventType,
  type SimPlainEventType,
  type SimRuleEventType,
} from '@/lib/workspace-events/constants'
import type {
  ExecutionEventContext,
  SimEventPayload,
  SimRunSummary,
} from '@/lib/workspace-events/types'

/**
 * Bounds the finalOutput field. Trace spans are never included; the payload
 * travels through the job queue, so large outputs are serialized and
 * truncated instead of being passed through whole.
 */
function boundFinalOutput(finalOutput: unknown): unknown {
  if (finalOutput === undefined || finalOutput === null) return null

  try {
    const serialized = JSON.stringify(finalOutput)
    if (serialized === undefined) return null
    if (serialized.length <= SIM_FINAL_OUTPUT_MAX_BYTES) return finalOutput
    const suffix = '... [truncated]'
    return truncate(serialized, SIM_FINAL_OUTPUT_MAX_BYTES - suffix.length, suffix)
  } catch {
    return null
  }
}

function basePayload(params: {
  event: SimEventType
  workflowId: string
  workflowName: string
}): SimEventPayload {
  return {
    event: params.event,
    timestamp: new Date().toISOString(),
    workflowId: params.workflowId,
    workflowName: params.workflowName,
    runId: null,
    durationMs: null,
    cost: null,
    finalOutput: null,
    triggeringRun: null,
    version: null,
  }
}

/** Run summary in user-facing units: cost in credits, finalOutput bounded. */
function summarizeRun(context: ExecutionEventContext): SimRunSummary {
  return {
    runId: context.executionId,
    durationMs: context.durationMs,
    // Costs are stored in dollars; credits are the user-facing unit.
    cost: dollarsToCredits(context.cost),
    finalOutput: boundFinalOutput(context.finalOutput),
  }
}

/**
 * Payload for run-backed events. Plain success/error events ARE the run, so
 * its summary sits at the top level; for rule events the run is evidence for
 * the condition that fired, so it nests under `triggeringRun`.
 */
export function buildExecutionEventPayload(params: {
  event: Exclude<SimPlainEventType, 'workflow_deployed' | 'workflow_undeployed'> | SimRuleEventType
  workflowName: string
  context: ExecutionEventContext
}): SimEventPayload {
  const { event, workflowName, context } = params

  const base = basePayload({ event, workflowId: context.workflowId, workflowName })
  const run = summarizeRun(context)

  if (event === 'execution_success' || event === 'execution_error') {
    return { ...base, ...run }
  }

  return { ...base, triggeringRun: run }
}

/** Payload for workflow_deployed events. */
export function buildDeployEventPayload(params: {
  workflowId: string
  workflowName: string
  version: number | null
}): SimEventPayload {
  return {
    ...basePayload({
      event: 'workflow_deployed',
      workflowId: params.workflowId,
      workflowName: params.workflowName,
    }),
    version: params.version,
  }
}

/** Payload for workflow_undeployed events. */
export function buildUndeployEventPayload(params: {
  workflowId: string
  workflowName: string
}): SimEventPayload {
  return basePayload({
    event: 'workflow_undeployed',
    workflowId: params.workflowId,
    workflowName: params.workflowName,
  })
}

/** Payload for no_activity events (no source run exists). */
export function buildNoActivityEventPayload(params: {
  workflowId: string
  workflowName: string
}): SimEventPayload {
  return basePayload({
    event: 'no_activity',
    workflowId: params.workflowId,
    workflowName: params.workflowName,
  })
}
