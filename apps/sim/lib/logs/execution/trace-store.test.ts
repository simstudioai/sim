/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { decryptSecretMock, materializeLargeValueRefMock, storeLargeValueMock, mockLogger } =
  vi.hoisted(() => ({
    decryptSecretMock: vi.fn(),
    materializeLargeValueRefMock: vi.fn(),
    storeLargeValueMock: vi.fn(),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }))

vi.mock('@sim/logger', () => ({
  createLogger: () => mockLogger,
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
  materializeExecutionDataForDisplayWithBlockOutputs,
  projectExecutionDataForDisplay,
  RESOLVED_SECRET_PROVENANCE_KEY,
  SECRET_PROJECTION_VERSION,
  stripSpanCosts,
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
  decryptSecretMock.mockResolvedValue({ decrypted: '12345678' })
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
        secretProjectionVersion: SECRET_PROJECTION_VERSION,
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
      secretProjectionVersion: SECRET_PROJECTION_VERSION,
      correlation,
      hasTraceSpans: true,
      traceSpanCount: 2,
    })

    await expect(materializeExecutionData(slim, CONTEXT)).resolves.toEqual({
      secretProjectionVersion: SECRET_PROJECTION_VERSION,
      correlation,
      hasTraceSpans: true,
      traceSpanCount: 2,
    })
  })
})

describe('projectExecutionDataForDisplay', () => {
  it('projects authoritative state-only block outputs without mutating execution state', async () => {
    const executionData = {
      secretProjectionVersion: SECRET_PROJECTION_VERSION,
      traceSpans: [],
      executionState: {
        resolvedSecretTraceProvenance: {
          version: 1 as const,
          complete: true,
          entries: [{ name: 'OPENAI_API_KEY', encryptedValue: 'ciphertext' }],
          scope: { userId: 'user-1', workspaceId: 'workspace-1' },
        },
        blockStates: {
          'function-1': {
            output: { token: 12345678, derived: 12345683 },
            resolvedSecretTraceProvenance: {
              version: 1 as const,
              complete: true,
              entries: [{ name: 'OPENAI_API_KEY', encryptedValue: 'ciphertext' }],
              scope: { userId: 'user-1', workspaceId: 'workspace-1' },
            },
          },
        },
      },
    }

    const materialized = await materializeExecutionDataForDisplayWithBlockOutputs(
      executionData,
      CONTEXT,
      ['function-1']
    )

    expect(materialized.executionData).not.toHaveProperty('executionState')
    expect(materialized.blockOutputs).toEqual(
      new Map([['function-1', { token: '{{OPENAI_API_KEY}}', derived: 12345683 }]])
    )
    expect(executionData.executionState.blockStates['function-1'].output).toEqual({
      token: 12345678,
      derived: 12345683,
    })
    expect(JSON.stringify(materialized.executionData)).not.toContain('12345678')
    expect(JSON.stringify([...materialized.blockOutputs])).not.toContain('12345678')
  })

  it('does not use trace output for a requested block missing from partial state', async () => {
    const emptyProvenance = {
      version: 1 as const,
      complete: true,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    }
    const materialized = await materializeExecutionDataForDisplayWithBlockOutputs(
      {
        secretProjectionVersion: SECRET_PROJECTION_VERSION,
        traceSpans: [
          {
            id: 'span-1',
            blockId: 'trace-only',
            name: 'Trace-only block',
            type: 'function',
            duration: 1,
            startTime: '2026-08-11T00:00:00.000Z',
            endTime: '2026-08-11T00:00:00.001Z',
            output: { result: 'trace-output' },
          },
        ],
        executionState: {
          resolvedSecretTraceProvenance: emptyProvenance,
          blockStates: {
            'state-only': {
              output: { result: 'state-output' },
              resolvedSecretTraceProvenance: emptyProvenance,
            },
          },
        },
      },
      CONTEXT,
      ['state-only', 'trace-only']
    )

    expect(materialized.blockOutputs).toEqual(new Map([['state-only', { result: 'state-output' }]]))
  })

  it('does not derive block outputs from legacy trace spans', async () => {
    const materialized = await materializeExecutionDataForDisplayWithBlockOutputs(
      {
        traceSpans: [
          {
            id: 'span-1',
            blockId: 'function-1',
            name: 'Function 1',
            type: 'function',
            duration: 1,
            startTime: '2026-08-11T00:00:00.000Z',
            endTime: '2026-08-11T00:00:00.001Z',
            output: { token: 'raw-legacy-secret' },
          },
        ],
      },
      CONTEXT,
      ['function-1']
    )

    expect(materialized.blockOutputs).toEqual(new Map())
  })

  it('does not mix legacy trace output into partial execution state', async () => {
    const materialized = await materializeExecutionDataForDisplayWithBlockOutputs(
      {
        traceSpans: [
          {
            id: 'span-1',
            blockId: 'trace-only',
            name: 'Trace-only block',
            type: 'function',
            duration: 1,
            startTime: '2026-08-11T00:00:00.000Z',
            endTime: '2026-08-11T00:00:00.001Z',
            output: { token: 'raw-legacy-secret' },
          },
        ],
        executionState: {
          blockStates: {
            'state-only': { output: { result: 'unproven-state-output' } },
          },
        },
      },
      CONTEXT,
      ['state-only', 'trace-only']
    )

    expect(materialized.blockOutputs).toEqual(new Map())
    expect(JSON.stringify([...materialized.blockOutputs])).not.toContain('raw-legacy-secret')
  })

  it('omits state-only block outputs that lack usable secret provenance', async () => {
    const materialized = await materializeExecutionDataForDisplayWithBlockOutputs(
      {
        secretProjectionVersion: SECRET_PROJECTION_VERSION,
        traceSpans: [
          {
            id: 'span-1',
            blockId: 'function-1',
            name: 'Function 1',
            type: 'function',
            duration: 1,
            startTime: '2026-08-11T00:00:00.000Z',
            endTime: '2026-08-11T00:00:00.001Z',
            output: { token: 'trace-fallback' },
          },
        ],
        executionState: {
          blockStates: {
            'function-1': { output: { token: 'unproven-secret' } },
          },
        },
      },
      CONTEXT,
      ['function-1']
    )

    expect(materialized.blockOutputs).toEqual(new Map())
    expect(JSON.stringify(materialized)).not.toContain('unproven-secret')
  })

  it('retains run-global projection for legacy rows without exact value sidecars', async () => {
    const executionData = {
      finalOutput: { result: 12345678, derived: 12345683 },
      workflowInput: { nested: { token: 'prefix-12345678-suffix' } },
      completionFailure: 'Function failed with 12345678',
      errorDetails: { blockId: 'function-1', error: 'Invalid token 12345678' },
      traceSpans: [
        {
          id: 'span-1',
          name: 'Function 1',
          type: 'function',
          duration: 1,
          startTime: '2026-07-31T00:00:00.000Z',
          endTime: '2026-07-31T00:00:00.001Z',
          output: { result: 12345678 },
        },
      ],
      executionState: {
        blockStates: { 'function-1': { output: { result: 12345678 } } },
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
      derived: 12345683,
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
    expect(executionData.finalOutput).toEqual({ result: 12345678, derived: 12345683 })
    expect(executionData.executionState.resolvedSecretTraceProvenance.entries).toEqual([
      { name: 'OPENAI_API_KEY', encryptedValue: 'ciphertext' },
    ])
    expect(JSON.stringify(displayData)).not.toContain('12345678')
  })

  it('projects only values carrying exact provenance when sibling fields share low-entropy bytes', async () => {
    decryptSecretMock.mockResolvedValue({ decrypted: 'TestValue' })
    const secretProvenance = {
      version: 1 as const,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'ciphertext' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    }
    const emptyProvenance = {
      version: 1 as const,
      complete: true,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    }
    const executionData = {
      finalOutput: { result: 'TestValue' },
      workflowInput: { token: 'TestValue' },
      executionState: {
        resolvedSecretTraceProvenance: secretProvenance,
        finalOutputResolvedSecretTraceProvenance: emptyProvenance,
        workflowInputResolvedSecretTraceProvenance: secretProvenance,
      },
    }

    const displayData = await projectExecutionDataForDisplay(executionData, CONTEXT)

    expect(displayData.finalOutput).toEqual({ result: 'TestValue' })
    expect(displayData.workflowInput).toEqual({ token: '{{TOKEN}}' })
    expect(displayData).not.toHaveProperty('executionState')
  })

  it('preserves the full display envelope for legacy rows without a projection contract', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        finalOutput: { result: 'unknown-secret' },
        workflowInput: { token: 'unknown-secret' },
        completionFailure: 'unknown-secret',
        executionState: { blockStates: { start: { output: 'legacy-input' } } },
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

    expect(displayData.finalOutput).toEqual({ result: 'unknown-secret' })
    expect(displayData.workflowInput).toEqual({ token: 'unknown-secret' })
    expect(displayData.completionFailure).toBe('unknown-secret')
    expect(displayData).not.toHaveProperty('executionState')
    expect(displayData.traceSpans).toEqual([
      expect.objectContaining({ output: { result: 'unknown-secret' } }),
    ])
  })

  it('fails closed for contract-aware rows without provenance', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        secretProjectionVersion: SECRET_PROJECTION_VERSION,
        finalOutput: { result: 'unknown-secret' },
        workflowInput: { token: 'unknown-secret' },
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

    expect(displayData).not.toHaveProperty('secretProjectionVersion')
    expect(displayData).not.toHaveProperty('finalOutput')
    expect(displayData).not.toHaveProperty('workflowInput')
    expect(displayData.traceSpans).toEqual([
      expect.not.objectContaining({ output: expect.anything() }),
    ])
  })

  it('fails closed when persisted provenance is incomplete', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        finalOutput: { result: 'unknown-secret' },
        executionState: {
          resolvedSecretTraceProvenance: {
            version: 1,
            complete: false,
            entries: [],
          },
        },
      },
      CONTEXT
    )

    expect(displayData).not.toHaveProperty('finalOutput')
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
        secretProjectionVersion: SECRET_PROJECTION_VERSION,
        traceSpans: { output: 'unsafe' },
      },
      CONTEXT
    )

    expect(displayData).not.toHaveProperty('traceSpans')
  })
})

describe('projectExecutionDataForDisplay provenance handling', () => {
  const PROVENANCE = { version: 1, complete: true, entries: [] } as const

  /** A truncated row: spans and markers survive, `executionState` does not. */
  function truncatedRow(overrides: Record<string, unknown> = {}) {
    return {
      secretProjectionVersion: SECRET_PROJECTION_VERSION,
      executionDataTruncated: true,
      finalOutput: { result: 'unknown-secret' },
      traceSpans: [
        {
          id: 'span-1',
          name: 'activeEmails',
          type: 'function',
          duration: 16,
          startTime: '2026-08-11T00:38:53.000Z',
          endTime: '2026-08-11T00:38:53.016Z',
          status: 'error',
          input: { code: 'const activeEmails = rows.length' },
          output: { error: 'nested large values' },
        },
      ],
      ...overrides,
    }
  }

  /** First span of a projected display payload. */
  function firstSpan(displayData: Record<string, unknown>): Record<string, unknown> {
    const [span] = displayData.traceSpans as Record<string, unknown>[]
    return span
  }

  it.each([
    ['a contract row', () => truncatedRow({ [RESOLVED_SECRET_PROVENANCE_KEY]: PROVENANCE })],
    ['a legacy row', () => ({ [RESOLVED_SECRET_PROVENANCE_KEY]: PROVENANCE, finalOutput: {} })],
  ])('never returns the resolved-secret provenance to the client from %s', async (_case, row) => {
    const displayData = await projectExecutionDataForDisplay(row(), CONTEXT)

    expect(displayData).not.toHaveProperty(RESOLVED_SECRET_PROVENANCE_KEY)
  })

  it('rebuilds the registry from the top-level key alone', async () => {
    const { secretProjectionVersion: _marker, ...withoutMarker } = truncatedRow()

    const displayData = await projectExecutionDataForDisplay(
      { ...withoutMarker, [RESOLVED_SECRET_PROVENANCE_KEY]: PROVENANCE },
      CONTEXT
    )

    expect(displayData.finalOutput).toEqual({ result: 'unknown-secret' })
    expect(firstSpan(displayData)).toHaveProperty('input')
  })

  it('keeps write-time-projected spans on a truncated row with no provenance', async () => {
    const displayData = await projectExecutionDataForDisplay(truncatedRow(), CONTEXT)

    expect(firstSpan(displayData)).toMatchObject({
      input: { code: 'const activeEmails = rows.length' },
      output: { error: 'nested large values' },
    })
    // The envelope has no write-time guarantee, so it still fails closed.
    expect(displayData).not.toHaveProperty('finalOutput')
  })

  it.each([
    ['the row was never truncated', { executionDataTruncated: undefined }],
    ['the provenance key is present but null', { [RESOLVED_SECRET_PROVENANCE_KEY]: null }],
    ['the provenance is malformed', { [RESOLVED_SECRET_PROVENANCE_KEY]: { version: 99 } }],
  ])('fails closed when %s', async (_case, overrides) => {
    const displayData = await projectExecutionDataForDisplay(truncatedRow(overrides), CONTEXT)

    const span = firstSpan(displayData)
    expect(span).not.toHaveProperty('input')
    expect(span).not.toHaveProperty('output')
  })

  it('leaves an empty span array intact', async () => {
    const displayData = await projectExecutionDataForDisplay(
      truncatedRow({ traceSpans: [] }),
      CONTEXT
    )

    expect(displayData.traceSpans).toEqual([])
  })
})

describe('stored provenance display reporting', () => {
  const REGISTRY_SUMMARY_MESSAGES = [
    'Resolved secret registry marked incomplete',
    'Resolved secret input path marked incomplete',
  ]

  function registrySummaryLines(): unknown[] {
    return [...mockLogger.warn.mock.calls, ...mockLogger.error.mock.calls].filter(([message]) =>
      REGISTRY_SUMMARY_MESSAGES.includes(message as string)
    )
  }

  /**
   * The stored state was recorded when the run wrote it; a view re-deriving it must say which
   * execution it served, once — not restate the latch through registry summaries that name none.
   */
  it('reports an incomplete stored envelope once, naming the execution and the parts', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        finalOutput: { result: 'value' },
        executionState: {
          resolvedSecretTraceProvenance: { version: 1, complete: false, entries: [] },
          finalOutputResolvedSecretTraceProvenance: { version: 1, complete: false, entries: [] },
        },
      },
      CONTEXT
    )

    expect(displayData).not.toHaveProperty('finalOutput')
    expect(registrySummaryLines()).toHaveLength(0)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Stored execution provenance cannot vouch for display content',
      expect.objectContaining({
        site: 'traceStore.displayProjection',
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        parts: ['traceSpans', 'finalOutput'],
        partCount: 2,
      })
    )
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('reports a malformed stored envelope at error, keeping the value withheld', async () => {
    const displayData = await projectExecutionDataForDisplay(
      {
        finalOutput: { result: 'value' },
        executionState: {
          resolvedSecretTraceProvenance: {
            version: 1,
            complete: true,
            entries: [],
            scope: { userId: 'user-1', workspaceId: 'workspace-1' },
          },
          finalOutputResolvedSecretTraceProvenance: 'garbage',
        },
      },
      CONTEXT
    )

    expect(displayData).not.toHaveProperty('finalOutput')
    expect(registrySummaryLines()).toHaveLength(0)
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Stored execution provenance is malformed',
      expect.objectContaining({
        site: 'traceStore.displayProjection',
        executionId: 'execution-1',
        parts: ['finalOutput'],
      })
    )
  })

  /** A complete envelope whose entries cannot be decrypted withholds content like any fault. */
  it('attributes an undecryptable stored envelope to its execution at error', async () => {
    decryptSecretMock.mockRejectedValue(new Error('key rotated'))

    const displayData = await projectExecutionDataForDisplay(
      {
        finalOutput: { result: 'value' },
        executionState: {
          resolvedSecretTraceProvenance: {
            version: 1,
            complete: true,
            entries: [],
            scope: { userId: 'user-1', workspaceId: 'workspace-1' },
          },
          finalOutputResolvedSecretTraceProvenance: {
            version: 1,
            complete: true,
            entries: [{ name: 'SECRET', encryptedValue: 'ciphertext' }],
            scope: { userId: 'user-1', workspaceId: 'workspace-1' },
          },
        },
      },
      CONTEXT
    )

    expect(displayData).not.toHaveProperty('finalOutput')
    expect(registrySummaryLines()).toHaveLength(0)
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Stored execution provenance could not be decrypted',
      expect.objectContaining({
        site: 'traceStore.displayProjection',
        executionId: 'execution-1',
        parts: ['finalOutput'],
      })
    )
  })

  it('reports a malformed block-output envelope at error, withholding the output', async () => {
    const result = await materializeExecutionDataForDisplayWithBlockOutputs(
      {
        executionState: {
          resolvedSecretTraceProvenance: {
            version: 1,
            complete: true,
            entries: [],
            scope: { userId: 'user-1', workspaceId: 'workspace-1' },
          },
          blockStates: {
            'block-1': { output: { value: 1 }, resolvedSecretTraceProvenance: 'garbage' },
          },
        },
      },
      CONTEXT,
      ['block-1']
    )

    expect(result.blockOutputs.has('block-1')).toBe(false)
    expect(registrySummaryLines()).toHaveLength(0)
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Stored execution provenance is malformed',
      expect.objectContaining({
        site: 'traceStore.blockOutputs',
        executionId: 'execution-1',
        parts: ['blockOutput:block-1'],
      })
    )
  })

  it('stays silent when every stored envelope is complete', async () => {
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
          finalOutputResolvedSecretTraceProvenance: {
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
    expect(mockLogger.warn).not.toHaveBeenCalled()
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  /** The block entry point runs both display functions; each names its own site for the envelope. */
  it('attributes an incomplete run envelope under both sites on a block-outputs read', async () => {
    await materializeExecutionDataForDisplayWithBlockOutputs(
      {
        finalOutput: { result: 'value' },
        executionState: {
          resolvedSecretTraceProvenance: { version: 1, complete: false, entries: [] },
          blockStates: {
            'block-1': { output: { value: 1 } },
          },
        },
      },
      CONTEXT,
      ['block-1']
    )

    expect(registrySummaryLines()).toHaveLength(0)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Stored execution provenance cannot vouch for display content',
      expect.objectContaining({ site: 'traceStore.displayProjection', parts: ['traceSpans'] })
    )
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Stored execution provenance cannot vouch for display content',
      expect.objectContaining({ site: 'traceStore.blockOutputs', parts: ['run'] })
    )
  })

  it('reports incomplete block-output envelopes once for the whole block read', async () => {
    const result = await materializeExecutionDataForDisplayWithBlockOutputs(
      {
        executionState: {
          resolvedSecretTraceProvenance: {
            version: 1,
            complete: true,
            entries: [],
            scope: { userId: 'user-1', workspaceId: 'workspace-1' },
          },
          blockStates: {
            'block-1': {
              output: { value: 1 },
              resolvedSecretTraceProvenance: { version: 1, complete: false, entries: [] },
            },
          },
        },
      },
      CONTEXT,
      ['block-1']
    )

    expect(result.blockOutputs.has('block-1')).toBe(false)
    expect(registrySummaryLines()).toHaveLength(0)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Stored execution provenance cannot vouch for display content',
      expect.objectContaining({
        site: 'traceStore.blockOutputs',
        executionId: 'execution-1',
        parts: ['blockOutput:block-1'],
      })
    )
  })
})

/**
 * `stripSpanCosts` is what stands between a joined cross-workspace child run and
 * the parent's reader: the child's spend is billed to the SOURCE workspace and
 * was never rolled into this run's total, so anything it leaves behind is spend
 * the reader was never meant to see.
 */
describe('stripSpanCosts', () => {
  function spanWithSpend() {
    return [
      {
        id: 'span-1',
        name: 'agent',
        cost: { total: 0.5 },
        tokens: { total: 900 },
        providerTiming: {
          duration: 5,
          segments: [
            { type: 'model', name: 'gpt-4', tokens: { total: 900 }, cost: { total: 0.5 } },
            { type: 'tool', name: 'search' },
          ],
        },
        children: [
          {
            id: 'span-2',
            name: 'model',
            cost: { total: 0.2 },
            tokens: { total: 400 },
            providerTiming: { segments: [{ type: 'model', tokens: { total: 400 } }] },
          },
        ],
      },
    ]
  }

  it('clears the span roll-up and the provider-timing segments that itemize it', () => {
    const spans = spanWithSpend()

    stripSpanCosts(spans)

    expect(spans[0].cost).toBeUndefined()
    expect(spans[0].tokens).toBeUndefined()
    const [modelSegment, toolSegment] = spans[0].providerTiming.segments as Array<
      Record<string, unknown>
    >
    expect(modelSegment.tokens).toBeUndefined()
    expect(modelSegment.cost).toBeUndefined()
    // Structure and identity are what the waterfall renders; only spend goes.
    expect(modelSegment).toMatchObject({ type: 'model', name: 'gpt-4' })
    expect(toolSegment).toMatchObject({ type: 'tool', name: 'search' })
  })

  it('reaches the segments of nested children too', () => {
    const spans = spanWithSpend()

    stripSpanCosts(spans)

    const child = spans[0].children[0]
    expect(child.cost).toBeUndefined()
    expect(child.tokens).toBeUndefined()
    expect(
      (child.providerTiming.segments as Array<Record<string, unknown>>)[0].tokens
    ).toBeUndefined()
  })

  it('leaves a span with no provider timing alone', () => {
    const spans = [{ id: 'span-1', name: 'api', cost: { total: 0.1 } }]

    expect(() => stripSpanCosts(spans)).not.toThrow()
    expect(spans[0]).toMatchObject({ id: 'span-1', name: 'api' })
  })
})
