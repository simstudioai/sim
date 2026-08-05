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

  it('omits log content and keeps only structural traces without trusted provenance', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        finalOutput: { result: 'unknown-secret' },
        workflowInput: { token: 'unknown-secret' },
        completionFailure: 'unknown-secret',
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

    expect(displayData).not.toHaveProperty('finalOutput')
    expect(displayData).not.toHaveProperty('workflowInput')
    expect(displayData).not.toHaveProperty('completionFailure')
    expect(displayData.traceSpans).toEqual([
      expect.not.objectContaining({ output: expect.anything() }),
    ])
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
