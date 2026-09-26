import { describe, expect, it } from 'vitest'
import {
  SIM_EVENT_PAYLOAD_FIELDS,
  SIM_FINAL_OUTPUT_MAX_BYTES,
} from '@/lib/workspace-events/constants'
import { buildExecutionEventPayload } from '@/lib/workspace-events/payload'
import type { ExecutionEventContext } from '@/lib/workspace-events/types'

const payloadKeys = Object.keys(SIM_EVENT_PAYLOAD_FIELDS).sort()

function makeContext(overrides: Partial<ExecutionEventContext> = {}): ExecutionEventContext {
  return {
    workflowId: 'wf-source',
    executionId: 'exec-1',
    status: 'error',
    durationMs: 1000,
    cost: 0.25,
    finalOutput: { result: 42 },
    ...overrides,
  }
}

describe('payload builders align with the shared field constants', () => {
  it('rule event payload nests the triggering run instead of top-level run fields', () => {
    const payload = buildExecutionEventPayload({
      event: 'cost_threshold',
      workflowName: 'Source',
      context: makeContext(),
    })
    expect(Object.keys(payload).sort()).toEqual(payloadKeys)
    expect(payload).toMatchObject({
      event: 'cost_threshold',
      runId: null,
      durationMs: null,
      cost: null,
      finalOutput: null,
      triggeringRun: {
        runId: 'exec-1',
        durationMs: 1000,
        // $0.25 reported as credits (1 credit = $0.005)
        cost: 50,
        finalOutput: { result: 42 },
      },
    })
  })
})

describe('finalOutput handling', () => {
  it('serializes and truncates oversized outputs', () => {
    const huge = { blob: 'x'.repeat(SIM_FINAL_OUTPUT_MAX_BYTES + 1024) }
    const payload = buildExecutionEventPayload({
      event: 'execution_error',
      workflowName: 'Source',
      context: makeContext({ finalOutput: huge }),
    })
    expect(typeof payload.finalOutput).toBe('string')
    expect((payload.finalOutput as string).length).toBeLessThanOrEqual(SIM_FINAL_OUTPUT_MAX_BYTES)
  })
})
