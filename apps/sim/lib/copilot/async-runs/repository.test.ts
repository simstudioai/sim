/**
 * @vitest-environment node
 */

import { dbChainMockFns, hasMockCondition, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claimCompletedAsyncToolCall,
  claimPendingAsyncToolCall,
  claimWorkflowToolExecution,
  completeAsyncToolCall,
  completeClaimedAsyncToolCall,
  completePendingAsyncToolCall,
  detachAsyncToolCall,
  getClaimedWorkflowExecutionId,
  markAsyncToolRunning,
  recordToolPermissionDecision,
  releaseWorkflowToolExecutionClaim,
  replaceTerminalAsyncToolCallResult,
  upsertAsyncToolCall,
} from './repository'

describe('async tool repository single-row semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('atomically completes a live row', async () => {
    const completedRow = {
      toolCallId: 'tool-1',
      status: 'completed',
      result: { ok: true },
      error: null,
    }
    dbChainMockFns.returning.mockResolvedValueOnce([completedRow])

    const result = await completeAsyncToolCall({
      toolCallId: 'tool-1',
      status: 'completed',
      result: { ok: true },
      error: null,
    })

    expect(result).toEqual(completedRow)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        result: { ok: true },
        completedAt: expect.any(Date),
      })
    )
    expect(dbChainMockFns.where).toHaveBeenCalled()
  })

  it('returns null when another terminal transition already won', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const result = await completeAsyncToolCall({
      toolCallId: 'tool-1',
      status: 'failed',
      result: null,
      error: 'late error',
    })

    expect(result).toBeNull()
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })

  it('atomically completes a native preclaim failure only while the row is pending', async () => {
    const failedRow = {
      toolCallId: 'browser-tool',
      status: 'failed',
      result: { error: 'Desktop action did not start' },
      error: 'Desktop action did not start',
    }
    dbChainMockFns.returning.mockResolvedValueOnce([failedRow])

    const result = await completePendingAsyncToolCall({
      toolCallId: 'browser-tool',
      status: 'failed',
      result: { error: 'Desktop action did not start' },
      error: 'Desktop action did not start',
    })

    expect(result).toEqual(failedRow)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        claimedBy: null,
        claimedAt: null,
        completedAt: expect.any(Date),
      })
    )
    const where = dbChainMockFns.where.mock.calls[0]?.[0]
    expect(
      hasMockCondition(
        where,
        (condition) =>
          condition.type === 'inArray' &&
          Array.isArray(condition.values) &&
          condition.values.length === 1 &&
          condition.values[0] === 'pending'
      )
    ).toBe(true)
  })

  it('returns null when a native authorization claim wins the pending completion race', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      completePendingAsyncToolCall({
        toolCallId: 'browser-tool',
        status: 'cancelled',
        result: { cancelled: true },
        error: 'Tool cancelled',
      })
    ).resolves.toBeNull()
  })

  it('atomically completes only the exact running native claim', async () => {
    const failedRow = {
      toolCallId: 'browser-tool',
      status: 'failed',
      claimedBy: null,
    }
    dbChainMockFns.returning.mockResolvedValueOnce([failedRow])

    const result = await completeClaimedAsyncToolCall(
      {
        toolCallId: 'browser-tool',
        status: 'failed',
        result: { outcomeUnknown: true, doNotRetry: true },
        error: 'Native outcome unknown',
      },
      'desktop-browser'
    )

    expect(result).toEqual(failedRow)
    const where = dbChainMockFns.where.mock.calls[0]?.[0]
    expect(
      hasMockCondition(
        where,
        (condition) =>
          condition.type === 'inArray' &&
          Array.isArray(condition.values) &&
          condition.values.length === 1 &&
          condition.values[0] === 'running'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        where,
        (condition) => condition.type === 'eq' && condition.right === 'desktop-browser'
      )
    ).toBe(true)
  })

  it('returns null when the exact native claim is no longer running', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      completeClaimedAsyncToolCall(
        {
          toolCallId: 'browser-tool',
          status: 'failed',
          error: 'Native outcome unknown',
        },
        'desktop-browser'
      )
    ).resolves.toBeNull()
  })

  it('atomically detaches a live background call and clears the claim fields', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        toolCallId: 'tool-1',
        status: 'delivered',
      },
    ])

    await detachAsyncToolCall('tool-1')

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'delivered',
        claimedBy: null,
        claimedAt: null,
      })
    )
    expect(dbChainMockFns.where).toHaveBeenCalled()
  })

  it('claims only completed rows for delivery handoff', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        toolCallId: 'tool-1',
        status: 'completed',
        claimedBy: 'worker-1',
      },
    ])

    const result = await claimCompletedAsyncToolCall('tool-1', 'worker-1')

    expect(result).toEqual({
      toolCallId: 'tool-1',
      status: 'completed',
      claimedBy: 'worker-1',
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        claimedBy: 'worker-1',
      })
    )
  })

  it('atomically marks one pending native tool claim as running', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        toolCallId: 'browser-tool',
        status: 'running',
        claimedBy: 'desktop-browser',
      },
    ])

    const result = await claimPendingAsyncToolCall('browser-tool', 'desktop-browser')

    expect(result).toMatchObject({
      toolCallId: 'browser-tool',
      status: 'running',
      claimedBy: 'desktop-browser',
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'running',
        claimedBy: 'desktop-browser',
        claimedAt: expect.any(Date),
      })
    )
  })

  it('atomically binds an eligible workflow tool to one execution', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        toolCallId: 'workflow-tool',
        status: 'running',
        claimedBy: 'workflow:execution-1',
      },
    ])

    const result = await claimWorkflowToolExecution('workflow-tool', 'execution-1')

    expect(result).toMatchObject({
      toolCallId: 'workflow-tool',
      claimedBy: 'workflow:execution-1',
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      status: expect.anything(),
      claimedBy: 'workflow:execution-1',
      claimedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
    expect(getClaimedWorkflowExecutionId(result?.claimedBy)).toBe('execution-1')
  })

  it('returns null when a workflow tool execution claim loses the race', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(claimWorkflowToolExecution('workflow-tool', 'execution-2')).resolves.toBeNull()
  })

  it('overwrites a workflow execution claim once the sim path starts running it', async () => {
    // The server-side fallback claims `workflow:<id>` and then immediately runs
    // the tool, whose executor re-marks the row as running under 'sim-stream'.
    // The claim value is therefore NOT durable identity — only its
    // `claimedBy IS NULL` precondition is load-bearing, since that is what keeps
    // a late browser locked out. Pinning this so nobody builds on reading it back.
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        toolCallId: 'workflow-tool',
        status: 'running',
        claimedBy: 'sim-stream',
      },
    ])

    const result = await markAsyncToolRunning('workflow-tool', 'sim-stream')

    expect(result).toMatchObject({ claimedBy: 'sim-stream' })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ claimedBy: 'sim-stream' })
    )
    expect(getClaimedWorkflowExecutionId('sim-stream')).toBeUndefined()
  })

  it('releases a matching pre-start workflow claim without changing its lifecycle status', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        toolCallId: 'workflow-tool',
        status: 'delivered',
        claimedBy: null,
      },
    ])

    const result = await releaseWorkflowToolExecutionClaim('workflow-tool', 'execution-1')

    expect(result).toMatchObject({
      toolCallId: 'workflow-tool',
      status: 'delivered',
      claimedBy: null,
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      claimedBy: null,
      claimedAt: null,
      updatedAt: expect.any(Date),
    })
  })

  it('detaches a bound workflow waiter without releasing its execution claim', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        toolCallId: 'workflow-tool',
        status: 'delivered',
        claimedBy: 'workflow:execution-1',
      },
    ])

    await detachAsyncToolCall('workflow-tool', { preserveClaim: true })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'delivered',
        claimedBy: undefined,
        claimedAt: undefined,
      })
    )
  })

  it('records an approved workflow decision without changing execution state', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        toolCallId: 'workflow-tool',
        status: 'pending',
        permissionDecision: 'allow',
      },
    ])

    await recordToolPermissionDecision('workflow-tool', 'allow')

    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      permissionDecision: 'allow',
      permissionDecidedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
  })

  it('replaces only terminal payload fields after trusted projection', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        toolCallId: 'workflow-tool',
        status: 'completed',
        result: { output: '{{SECRET}}' },
      },
    ])

    const result = await replaceTerminalAsyncToolCallResult({
      toolCallId: 'workflow-tool',
      status: 'completed',
      result: { output: '{{SECRET}}' },
      error: null,
    })

    expect(result).toMatchObject({
      toolCallId: 'workflow-tool',
      status: 'completed',
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      status: 'completed',
      result: { output: '{{SECRET}}' },
      error: null,
      updatedAt: expect.any(Date),
    })
    expect(dbChainMockFns.where).toHaveBeenCalled()
  })

  it.each(['pending', 'running'] as const)(
    'keeps the first finalized call identity immutable after it reaches %s',
    async (status) => {
      const existingRow = {
        runId: 'run-1',
        toolCallId: 'tool-1',
        toolName: 'run_function',
        args: { language: 'javascript', code: 'return {{FIRST_SECRET}}' },
        status,
      }
      dbChainMockFns.limit.mockResolvedValueOnce([existingRow])

      const result = await upsertAsyncToolCall({
        runId: 'run-1',
        toolCallId: 'tool-1',
        toolName: 'run_function',
        args: { language: 'javascript', code: 'return {{SECOND_SECRET}}' },
        status: 'pending',
      })

      expect(result).toEqual(existingRow)
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    }
  )

  it('refuses a provider-ID collision with an existing row in another run', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { runId: 'old-run', toolCallId: 'provider-shared-call', toolName: 'browser_close_tab' },
    ])
    await expect(
      upsertAsyncToolCall({
        runId: 'current-run',
        toolCallId: 'provider-shared-call',
        toolName: 'glob',
      })
    ).rejects.toThrow('Async tool call belongs to another run')
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })

  it('refuses a foreign row that wins the insert race', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ runId: 'other-run', toolCallId: 'call-race' }])
    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(
      upsertAsyncToolCall({ runId: 'current-run', toolCallId: 'call-race', toolName: 'glob' })
    ).rejects.toThrow('Async tool call belongs to another run')
  })
})
