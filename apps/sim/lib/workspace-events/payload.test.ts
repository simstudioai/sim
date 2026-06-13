/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  SIM_EVENT_PAYLOAD_FIELDS,
  SIM_FINAL_OUTPUT_MAX_BYTES,
} from '@/lib/workspace-events/constants'
import {
  buildDeployEventPayload,
  buildExecutionEventPayload,
  buildNoActivityEventPayload,
} from '@/lib/workspace-events/payload'
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
  it('run-backed event payload has exactly the declared keys', () => {
    const payload = buildExecutionEventPayload({
      event: 'execution_error',
      workflowName: 'Source',
      context: makeContext(),
    })
    expect(Object.keys(payload).sort()).toEqual(payloadKeys)
    expect(payload).toMatchObject({
      event: 'execution_error',
      workflowId: 'wf-source',
      workflowName: 'Source',
      runId: 'exec-1',
      durationMs: 1000,
      // $0.25 reported as credits (1 credit = $0.005)
      cost: 50,
    })
  })

  it('deploy event payload has exactly the declared keys with run fields null', () => {
    const payload = buildDeployEventPayload({
      workflowId: 'wf-source',
      workflowName: 'Source',
      version: 3,
    })
    expect(Object.keys(payload).sort()).toEqual(payloadKeys)
    expect(payload).toMatchObject({
      event: 'workflow_deployed',
      workflowId: 'wf-source',
      workflowName: 'Source',
      runId: null,
      durationMs: null,
      cost: null,
      finalOutput: null,
      version: 3,
    })
  })

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

  it('no-activity payload has exactly the declared keys with run fields null', () => {
    const payload = buildNoActivityEventPayload({
      workflowId: 'wf-source',
      workflowName: 'Source',
    })
    expect(Object.keys(payload).sort()).toEqual(payloadKeys)
    expect(payload).toMatchObject({
      event: 'no_activity',
      runId: null,
      finalOutput: null,
    })
  })
})

describe('finalOutput handling', () => {
  it('passes small outputs through untouched', () => {
    const payload = buildExecutionEventPayload({
      event: 'execution_error',
      workflowName: 'Source',
      context: makeContext(),
    })
    expect(payload.finalOutput).toEqual({ result: 42 })
  })

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

  it('is nested under triggeringRun for rule events', () => {
    const payload = buildExecutionEventPayload({
      event: 'cost_threshold',
      workflowName: 'Source',
      context: makeContext(),
    })
    expect(payload.finalOutput).toBeNull()
    expect(payload.triggeringRun?.finalOutput).toEqual({ result: 42 })
  })

  it('is null when the source run produced no output', () => {
    const payload = buildExecutionEventPayload({
      event: 'execution_success',
      workflowName: 'Source',
      context: makeContext({ status: 'success', finalOutput: undefined }),
    })
    expect(payload.finalOutput).toBeNull()
  })
})
