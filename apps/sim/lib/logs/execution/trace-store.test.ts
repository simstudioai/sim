/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { decryptSecretMock, materializeLargeValueRefMock, storeLargeValueMock } = vi.hoisted(() => ({
  decryptSecretMock: vi.fn(),
  materializeLargeValueRefMock: vi.fn(),
  storeLargeValueMock: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: decryptSecretMock,
}))

vi.mock('@/lib/execution/payloads/store', () => ({
  materializeLargeValueRef: materializeLargeValueRefMock,
  storeLargeValue: storeLargeValueMock,
}))

import {
  externalizeExecutionData,
  materializeExecutionData,
  projectExecutionDataForDisplay,
  TRACE_STORE_REF_KEY,
} from '@/lib/logs/execution/trace-store'

const CONTEXT = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  userId: 'user-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  decryptSecretMock.mockResolvedValue({ decrypted: '1234' })
})

describe('execution data storage', () => {
  it('keeps the trusted Copilot binding when an externalized payload is unavailable', async () => {
    const correlation = { copilotToolCallId: 'tool-call-1' }
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_bbbbbbbbbbbb',
      kind: 'object',
      size: 128,
      key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_bbbbbbbbbbbb.json',
      executionId: 'execution-1',
      preview: { unsafe: 'must-not-remain-inline' },
    } as const
    storeLargeValueMock.mockResolvedValue(ref)
    materializeLargeValueRefMock.mockRejectedValue(new Error('object unavailable'))

    const slim = await externalizeExecutionData(
      {
        correlation,
        hasTraceSpans: true,
        traceSpanCount: 2,
        finalOutput: { unsafe: 'must-not-remain-inline' },
      },
      CONTEXT
    )

    expect(slim).toEqual({
      [TRACE_STORE_REF_KEY]: {
        __simLargeValueRef: true,
        version: 1,
        id: 'lv_bbbbbbbbbbbb',
        kind: 'object',
        size: 128,
        key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_bbbbbbbbbbbb.json',
        executionId: 'execution-1',
      },
      correlation,
      hasTraceSpans: true,
      traceSpanCount: 2,
    })

    await expect(materializeExecutionData(slim, CONTEXT)).resolves.toEqual({
      correlation,
      hasTraceSpans: true,
      traceSpanCount: 2,
    })
  })
})

describe('projectExecutionDataForDisplay', () => {
  it('projects persisted output, input, errors, and spans from trusted provenance', async () => {
    const executionData = {
      finalOutput: { result: 1234, derived: 1239 },
      workflowInput: { nested: { token: 'prefix-1234-suffix' } },
      completionFailure: 'Function failed with 1234',
      errorDetails: { blockId: 'function-1', error: 'Invalid token 1234' },
      traceSpans: [
        {
          id: 'span-1',
          name: 'Function 1',
          type: 'function',
          duration: 1,
          startTime: '2026-07-31T00:00:00.000Z',
          endTime: '2026-07-31T00:00:00.001Z',
          output: { result: 1234 },
        },
      ],
      executionState: {
        blockStates: { 'function-1': { output: { result: 1234 } } },
        resolvedSecretTraceProvenance: {
          version: 1 as const,
          complete: true,
          entries: [{ name: 'OPENAI_API_KEY', encryptedValue: 'ciphertext' }],
          scope: { userId: 'user-1', workspaceId: 'workspace-1' },
        },
      },
    }

    const displayData = await projectExecutionDataForDisplay(executionData, CONTEXT)

    expect(displayData.finalOutput).toEqual({
      result: '{{OPENAI_API_KEY}}',
      derived: 1239,
    })
    expect(displayData.workflowInput).toEqual({
      nested: { token: 'prefix-{{OPENAI_API_KEY}}-suffix' },
    })
    expect(displayData.completionFailure).toBe('Function failed with {{OPENAI_API_KEY}}')
    expect(displayData.errorDetails).toEqual({
      blockId: 'function-1',
      error: 'Invalid token {{OPENAI_API_KEY}}',
    })
    expect(displayData.traceSpans).toEqual([
      expect.objectContaining({ output: { result: '{{OPENAI_API_KEY}}' } }),
    ])
    expect(displayData).not.toHaveProperty('executionState')
    expect(executionData.finalOutput).toEqual({ result: 1234, derived: 1239 })
    expect(executionData.executionState.resolvedSecretTraceProvenance.entries).toEqual([
      { name: 'OPENAI_API_KEY', encryptedValue: 'ciphertext' },
    ])
    expect(JSON.stringify(displayData)).not.toContain('1234')
  })

  it('keeps the trigger payload but omits post-execution content without trusted provenance', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        finalOutput: { result: 'unknown-secret' },
        workflowInput: { channel: 'C123' },
        completionFailure: 'unknown-secret',
        blockInput: { apiKey: 'unknown-secret' },
        blockExecutions: [{ output: 'unknown-secret' }],
        traceSpans: [
          {
            id: 'span-1',
            name: 'Function 1',
            type: 'function',
            duration: 1,
            startTime: '2026-07-31T00:00:00.000Z',
            endTime: '2026-07-31T00:00:00.001Z',
            output: { result: 'unknown-secret' },
          },
        ],
      },
      CONTEXT
    )

    expect(displayData.workflowInput).toEqual({ channel: 'C123' })
    expect(displayData).not.toHaveProperty('finalOutput')
    expect(displayData).not.toHaveProperty('completionFailure')
    expect(displayData).not.toHaveProperty('blockInput')
    expect(displayData).not.toHaveProperty('blockExecutions')
    expect(displayData.traceSpans).toEqual([
      expect.not.objectContaining({ output: expect.anything() }),
    ])
  })

  it('keeps the trigger payload but omits the final output when provenance is incomplete', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        finalOutput: { result: 'unknown-secret' },
        workflowInput: { channel: 'C123' },
        blockInput: { apiKey: 'unknown-secret' },
        executionState: {
          resolvedSecretTraceProvenance: {
            version: 1,
            complete: false,
            entries: [],
            scope: { userId: 'user-1', workspaceId: 'workspace-1' },
          },
        },
      },
      CONTEXT
    )

    expect(displayData.workflowInput).toEqual({ channel: 'C123' })
    expect(displayData).not.toHaveProperty('finalOutput')
    expect(displayData).not.toHaveProperty('blockInput')
  })

  it('recovers workflowInput from the trigger block state on legacy execution data', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        executionState: {
          blockStates: {
            'trigger-1': {
              executed: false,
              executionTime: 0,
              output: { team_id: 'T1', event: { text: 'hello' }, token: 'slack-verification' },
            },
            'function-1': { executed: true, executionTime: 12, output: { result: 'ok' } },
          },
        },
      },
      CONTEXT
    )

    expect(displayData.workflowInput).toEqual({ team_id: 'T1', event: { text: 'hello' } })
  })

  it.each([
    ['incomplete', false],
    ['complete', true],
  ])(
    'does not recover from block state once provenance is stamped (%s)',
    async (_name, complete) => {
      const displayData = await projectExecutionDataForDisplay(
        {
          executionState: {
            blockStates: {
              'trigger-1': {
                executed: false,
                executionTime: 0,
                output: { apiKey: 'BLOCK-STATE-MUST-NOT-SURFACE' },
              },
            },
            resolvedSecretTraceProvenance: {
              version: 1,
              complete,
              entries: [],
              scope: { userId: 'user-1', workspaceId: 'workspace-1' },
            },
          },
        },
        CONTEXT
      )

      expect(displayData).not.toHaveProperty('workflowInput')
      expect(JSON.stringify(displayData)).not.toContain('BLOCK-STATE-MUST-NOT-SURFACE')
    }
  )

  it.each([
    ['empty block states', { blockStates: {} }],
    ['no block states key', { executedBlocks: [] }],
    ['non-record block states', { blockStates: [] }],
  ])(
    'does not attempt recovery for a run that never reached the executor (%s)',
    async (_name, executionState) => {
      const displayData = await projectExecutionDataForDisplay({ executionState }, CONTEXT)

      expect(displayData).not.toHaveProperty('workflowInput')
    }
  )

  /**
   * The shape a run that failed before the executor started leaves behind: no
   * `workflowInput` and no `executionState` at all.
   */
  it('renders nothing for a failed run that persisted neither input nor state', async () => {
    const displayData = await projectExecutionDataForDisplay(
      { finalOutput: { error: 'failed before blocks' }, completionFailure: 'boom' },
      CONTEXT
    )

    expect(displayData).not.toHaveProperty('workflowInput')
    expect(displayData).not.toHaveProperty('finalOutput')
    expect(displayData).not.toHaveProperty('completionFailure')
  })

  /**
   * A nested run receives `workflowInput` from its parent's already-resolved
   * block outputs (workflow-handler.ts passes `workflowInput: childWorkflowInput`),
   * so the boundary premise does not hold and it must fail closed.
   */
  it.each([['workflow'], ['custom_block']])(
    'gates workflowInput for a nested %s execution without trusted provenance',
    async (triggerType) => {
      const displayData = await projectExecutionDataForDisplay(
        {
          trigger: { type: triggerType, source: triggerType },
          workflowInput: { apiKey: 'PARENT-RESOLVED-SECRET' },
          executionState: {
            blockStates: {
              'trigger-1': { executed: false, executionTime: 0, output: { a: 1 } },
            },
          },
        },
        CONTEXT
      )

      expect(displayData).not.toHaveProperty('workflowInput')
      expect(JSON.stringify(displayData)).not.toContain('PARENT-RESOLVED-SECRET')
    }
  )

  /**
   * A re-run presents whatever trigger type its caller asked for, so the value
   * copied out of a nested run would otherwise look inbound. The stamped source
   * id keeps it gated.
   */
  it('gates workflowInput inherited from a prior execution regardless of trigger type', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        trigger: {
          type: 'manual',
          source: 'manual',
          data: { inputSourceExecutionId: 'execution-source-1' },
        },
        workflowInput: { apiKey: 'INHERITED-FROM-CUSTOM-BLOCK-PARENT' },
      },
      CONTEXT
    )

    expect(displayData).not.toHaveProperty('workflowInput')
    expect(JSON.stringify(displayData)).not.toContain('INHERITED-FROM-CUSTOM-BLOCK-PARENT')
  })

  it('keeps the exemption for a manual run whose trigger data carries no input source', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        trigger: { type: 'manual', source: 'manual', data: { correlation: { a: 1 } } },
        workflowInput: { question: 'typed by the user' },
      },
      CONTEXT
    )

    expect(displayData.workflowInput).toEqual({ question: 'typed by the user' })
  })

  it('still redacts and shows a nested execution input when provenance is complete', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        trigger: { type: 'workflow', source: 'workflow' },
        workflowInput: { apiKey: 1234 },
        executionState: {
          resolvedSecretTraceProvenance: {
            version: 1,
            complete: true,
            entries: [{ name: 'OPENAI_API_KEY', encryptedValue: 'ciphertext' }],
            scope: { userId: 'user-1', workspaceId: 'workspace-1' },
          },
        },
      },
      CONTEXT
    )

    expect(displayData.workflowInput).toEqual({ apiKey: '{{OPENAI_API_KEY}}' })
  })

  it('keeps the boundary exemption for a provider-named webhook trigger', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        trigger: { type: 'zoho_desk', source: 'zoho_desk' },
        workflowInput: { eventType: 'Ticket_Comment_Add' },
      },
      CONTEXT
    )

    expect(displayData.workflowInput).toEqual({ eventType: 'Ticket_Comment_Add' })
  })

  /**
   * A human-in-the-loop pause writes a placeholder block state with the same
   * never-executed / zero-duration / populated-output shape as the trigger, so
   * a paused legacy run has two matches. Guessing would show the resume
   * capability URL labelled as the workflow input.
   */
  it('refuses recovery when a resume placeholder shares the trigger shape', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        executionState: {
          blockStates: {
            'hitl-1': {
              executed: false,
              executionTime: 0,
              output: {
                url: 'https://sim.example/resume/CAPABILITY-URL',
                resumeEndpoint: 'https://sim.example/api/resume/CAPABILITY-URL',
              },
            },
            'trigger-1': { executed: false, executionTime: 0, output: { channel: 'C123' } },
          },
        },
      },
      CONTEXT
    )

    expect(displayData).not.toHaveProperty('workflowInput')
    expect(JSON.stringify(displayData)).not.toContain('CAPABILITY-URL')
  })

  /**
   * `buildApiOrInputOutput` writes `{...finalInput, input: {...finalInput}}` for
   * an object input, so the original workflowInput was the FLAT object. Keep
   * that shape instead of collapsing to the redundant nested clone.
   */
  it('keeps the flat shape when the nested input is a clone of its siblings', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        executionState: {
          blockStates: {
            'trigger-1': {
              executed: false,
              executionTime: 0,
              output: {
                leadId: 'lead-42',
                source: 'crm',
                input: { leadId: 'lead-42', source: 'crm' },
              },
            },
          },
        },
      },
      CONTEXT
    )

    expect(displayData.workflowInput).toEqual({
      leadId: 'lead-42',
      source: 'crm',
      input: { leadId: 'lead-42', source: 'crm' },
    })
  })

  it('recovers a non-record trigger payload without narrowing it', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        executionState: {
          blockStates: {
            'trigger-1': { executed: false, executionTime: 0, output: 'run calendar test' },
          },
        },
      },
      CONTEXT
    )

    expect(displayData.workflowInput).toBe('run calendar test')
  })

  it('does not recover over a persisted null workflowInput', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        workflowInput: null,
        executionState: {
          blockStates: {
            'trigger-1': { executed: false, executionTime: 0, output: { channel: 'C123' } },
          },
        },
      },
      CONTEXT
    )

    expect(displayData.workflowInput).toBeNull()
  })

  it('narrows a recovered nested input payload to the shape workflowInput held', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        executionState: {
          blockStates: {
            'trigger-1': {
              executed: false,
              executionTime: 0,
              output: {
                input: { brandInfo: 'acme', adUnitName: 'derived' },
                brandInfo: 'acme',
                referenceImageUrl: 'https://example.com/a.png',
              },
            },
          },
        },
      },
      CONTEXT
    )

    expect(displayData.workflowInput).toEqual({
      input: { brandInfo: 'acme', adUnitName: 'derived' },
    })
  })

  it('leaves a persisted workflowInput untouched by legacy recovery', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        workflowInput: { token: 'kept-as-persisted', input: { a: 1 }, sibling: 2 },
        executionState: {
          blockStates: {
            'trigger-1': { executed: false, executionTime: 0, output: { other: 'ignored' } },
          },
        },
      },
      CONTEXT
    )

    expect(displayData.workflowInput).toEqual({
      token: 'kept-as-persisted',
      input: { a: 1 },
      sibling: 2,
    })
  })

  it('preserves direct literals when trusted provenance has no activated secrets', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        finalOutput: { result: 'direct-literal' },
        executionState: {
          resolvedSecretTraceProvenance: {
            version: 1,
            complete: true,
            entries: [],
            scope: { userId: 'user-1', workspaceId: 'workspace-1' },
          },
        },
      },
      CONTEXT
    )

    expect(displayData.finalOutput).toEqual({ result: 'direct-literal' })
  })

  it('omits malformed trace content even when it was present on the stored row', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        traceSpans: { output: 'unsafe' },
      },
      CONTEXT
    )

    expect(displayData).not.toHaveProperty('traceSpans')
  })
})
