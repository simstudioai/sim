import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  decryptSecretMock,
  materializeLargeValueRefMock,
  storeExecutionTraceArchiveMock,
  mockLogger,
} = vi.hoisted(() => ({
  decryptSecretMock: vi.fn(),
  materializeLargeValueRefMock: vi.fn(),
  storeExecutionTraceArchiveMock: vi.fn(),
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
  storeExecutionTraceArchive: storeExecutionTraceArchiveMock,
}))

import {
  copyTraceSpansWithoutCosts,
  externalizeExecutionData,
  materializeExecutionData,
  materializeExecutionDataForDisplayWithBlockOutputs,
  projectExecutionDataForDisplay,
  RESOLVED_SECRET_PROVENANCE_KEY,
  SECRET_PROJECTION_VERSION,
  stripJoinedChildTraceSpend,
  stripSpanCosts,
  TRACE_STORE_REF_KEY,
} from '@/lib/logs/execution/trace-store'
import type { TraceSpan } from '@/lib/logs/types'

const CONTEXT = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  userId: 'user-1',
}

beforeEach(() => {
  decryptSecretMock.mockResolvedValue({ decrypted: '12345678' })
})

describe('execution data storage', () => {
  it('propagates the original storage failure for strict backfills', async () => {
    const cause = new Error('column "size_bytes" does not exist')
    const error = new Error('Failed query', { cause })
    storeExecutionTraceArchiveMock.mockRejectedValueOnce(error)

    await expect(
      externalizeExecutionData({ traceSpans: [] }, CONTEXT, { throwOnError: true })
    ).rejects.toBe(error)
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('rejects missing ownership before strict backfills write anything', async () => {
    await expect(
      externalizeExecutionData(
        { traceSpans: [] },
        { ...CONTEXT, userId: '' },
        { throwOnError: true }
      )
    ).rejects.toThrow('Trace storage requires workspaceId, workflowId, and userId')
    expect(storeExecutionTraceArchiveMock).not.toHaveBeenCalled()
  })

  it('preserves inline completion data and logs the underlying database error', async () => {
    const data = { traceSpans: [] }
    storeExecutionTraceArchiveMock.mockRejectedValueOnce(
      new Error('Failed query\nparams: private-payload', {
        cause: new Error('permission denied for table workspace_files'),
      })
    )
    await expect(externalizeExecutionData(data, CONTEXT)).resolves.toBe(data)
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.any(String), {
      executionId: CONTEXT.executionId,
      error: expect.objectContaining({ message: 'permission denied for table workspace_files' }),
    })
    expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain('private-payload')
  })

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
    storeExecutionTraceArchiveMock.mockResolvedValue(ref)
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
      hasHandledErrors: false,
    })

    await expect(materializeExecutionData(slim, CONTEXT)).resolves.toEqual({
      secretProjectionVersion: SECRET_PROJECTION_VERSION,
      correlation,
      hasTraceSpans: true,
      traceSpanCount: 2,
      hasHandledErrors: false,
    })
  })

  it.each([
    { traceSpans: [{ children: [{ status: 'error', errorHandled: true }] }], expected: true },
    { traceSpans: [{ status: 'error', errorHandled: false }], expected: false },
    {
      traceSpans: [{ status: 'success', output: { status: 'error', errorHandled: true } }],
      expected: false,
    },
  ])(
    'retains handled-error classification without loading trace IO: $expected',
    async ({ traceSpans, expected }) => {
      storeExecutionTraceArchiveMock.mockResolvedValue({
        __simLargeValueRef: true,
        version: 1,
        id: 'lv_bbbbbbbbbbbb',
        kind: 'object',
        size: 128,
        key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_bbbbbbbbbbbb.json',
        executionId: 'execution-1',
      })
      materializeLargeValueRefMock.mockRejectedValue(new Error('object unavailable'))
      const slim = await externalizeExecutionData({ traceSpans }, CONTEXT)
      expect(slim.hasHandledErrors).toBe(expected)
      expect(slim).not.toHaveProperty('traceSpans')
      const metadata = await materializeExecutionData(slim, CONTEXT)
      expect(metadata.hasHandledErrors).toBe(expected)
    }
  )
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
})

/**
 * The two strips are not the same removal, and the difference is whether the
 * result is written.
 *
 * `stripJoinedChildTraceSpend` is what stands between a joined cross-workspace
 * child run and the parent's reader: the child's spend is billed to the SOURCE
 * workspace and was never rolled into this run's total, so anything it leaves
 * behind is spend the reader was never meant to see — and it never persists.
 * `stripSpanCosts` runs inside `backfill-trace-spans.ts`, which stores what it
 * returns, so anything IT clears is gone for every authorized reader of that run
 * forever. Only the dollars belong in that set.
 */
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

describe('stripJoinedChildTraceSpend', () => {
  it('clears the span roll-up and the provider-timing segments that itemize it', () => {
    const spans = spanWithSpend()

    stripJoinedChildTraceSpend(spans)

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

    stripJoinedChildTraceSpend(spans)

    const child = spans[0].children[0]
    expect(child.cost).toBeUndefined()
    expect(child.tokens).toBeUndefined()
    expect(
      (child.providerTiming.segments as Array<Record<string, unknown>>)[0].tokens
    ).toBeUndefined()
  })
})

describe('stripSpanCosts', () => {
  it('clears cost at both levels and through children', () => {
    const spans = spanWithSpend()

    stripSpanCosts(spans)

    expect(spans[0].cost).toBeUndefined()
    expect(spans[0].children[0].cost).toBeUndefined()
    expect(
      (spans[0].providerTiming.segments as Array<Record<string, unknown>>)[0].cost
    ).toBeUndefined()
  })

  /**
   * The migration stores what this returns. A legacy run's token counts are
   * ordinary trace detail its authorized readers have always had, and the ledger
   * — not the span — is where dollars live, so erasing them buys nothing and
   * cannot be undone.
   */
  it('keeps the token counts the migration is about to persist', () => {
    const spans = spanWithSpend()

    stripSpanCosts(spans)

    expect(spans[0].tokens).toEqual({ total: 900 })
    expect(spans[0].children[0].tokens).toEqual({ total: 400 })
    const segments = spans[0].providerTiming.segments as Array<Record<string, unknown>>
    expect(segments[0].tokens).toEqual({ total: 900 })
    expect(
      (spans[0].children[0].providerTiming.segments as Array<Record<string, unknown>>)[0].tokens
    ).toEqual({ total: 400 })
  })
})

/**
 * The COMPLETION write. `stripSpanCosts` only ever ran over legacy rows the
 * backfill touched; every normal run went through this copy, which used to drop
 * the span's own `cost` and leave the same dollars itemized underneath it in
 * `providerTiming.segments`. Both writers now share one removal rule, so the
 * two cannot answer differently about what a persisted span may carry.
 */
describe('copyTraceSpansWithoutCosts', () => {
  it('clears the segment dollars the completion write used to persist', () => {
    const spans = spanWithSpend() as unknown as TraceSpan[]

    const persisted = copyTraceSpansWithoutCosts(spans)

    const [span] = persisted as Array<Record<string, any>>
    expect(span.cost).toBeUndefined()
    expect(span.providerTiming.segments[0].cost).toBeUndefined()
    expect(span.children[0].cost).toBeUndefined()
    expect(span.children[0].providerTiming.segments[0].cost).toBeUndefined()
  })

  it('keeps the token counts and the segment identity a trace is read for', () => {
    const spans = spanWithSpend() as unknown as TraceSpan[]

    const [span] = copyTraceSpansWithoutCosts(spans) as unknown as Array<Record<string, any>>

    expect(span.tokens).toEqual({ total: 900 })
    expect(span.children[0].tokens).toEqual({ total: 400 })
    expect(span.providerTiming.segments[0]).toMatchObject({
      type: 'model',
      name: 'gpt-4',
      tokens: { total: 900 },
    })
    expect(span.providerTiming.duration).toBe(5)
  })
})
