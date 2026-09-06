/**
 * @vitest-environment node
 */

import {
  copilotAsyncToolCalls,
  copilotChats,
  copilotRequestStops,
  copilotRuns,
} from '@sim/db/schema'
import { dbChainMockFns, hasMockCondition, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  areStreamToolExecutionsSettled,
  claimCompletedAsyncToolCall,
  claimPendingAsyncToolCall,
  claimSimToolExecution,
  claimWorkflowToolExecution,
  closeStreamToolAdmission,
  completeAsyncToolCall,
  completeClaimedAsyncToolCall,
  completePendingAsyncToolCall,
  createRunSegment,
  detachAsyncToolCall,
  getClaimedWorkflowExecutionId,
  getUnsettledStreamSandboxProcesses,
  markAsyncToolRunning,
  recordSimSandboxProcess,
  recordToolPermissionDecision,
  releaseWorkflowToolExecutionClaim,
  replaceTerminalAsyncToolCallResult,
  settleSimSandboxProcess,
  settleSimToolExecution,
  stopPendingRequest,
  updateRunStatus,
  upsertAsyncToolCall,
} from '@/lib/mothership/async-runs/repository'

describe('run admission and early Stop', () => {
  const scope = { userId: 'user-1', workspaceId: 'workspace-1', streamId: 'stream-1' }
  const input = { ...scope, chatId: 'chat-1', executionId: 'execution-1' }
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('records a pending Stop using the authenticated actor and workspace', async () => {
    expect(await stopPendingRequest(scope)).toBeNull()
    expect(dbChainMockFns.values).toHaveBeenCalledWith(scope)
    expect(dbChainMockFns.onConflictDoNothing).toHaveBeenCalled()
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(2)
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[0]?.[0],
        (condition) =>
          condition.type === 'eq' &&
          condition.left === copilotRuns.userId &&
          condition.right === scope.userId
      )
    ).toBe(true)
  })

  it('retains an admitted run for the normal authorized Stop path', async () => {
    const run = { ...input, status: 'active' }
    queueTableRows(copilotRuns, [run])
    expect(await stopPendingRequest(scope)).toEqual(run)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('acknowledges a delayed cancelled admission without requiring a nonexistent worker run', async () => {
    queueTableRows(copilotRuns, [{ ...input, status: 'cancelled' }])
    queueTableRows(copilotRequestStops, [{ ...scope, stoppedAt: new Date() }])
    expect(await stopPendingRequest(scope)).toBeNull()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('does not confuse an ordinary cancelled run with one stopped before admission', async () => {
    const run = { ...input, status: 'cancelled' }
    queueTableRows(copilotRuns, [run])
    expect(await stopPendingRequest(scope)).toEqual(run)
  })

  it('creates a terminal, tool-closed run when a scoped Stop preceded admission', async () => {
    const stoppedAt = new Date('2026-09-01T00:00:00Z')
    queueTableRows(copilotRequestStops, [{ ...scope, stoppedAt }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'run-1', status: 'cancelled' }])
    expect(await createRunSegment(input)).toMatchObject({ status: 'cancelled' })
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'cancelled',
        toolAdmissionClosedAt: stoppedAt,
        completedAt: expect.anything(),
      })
    )
    for (const [column, value] of [
      [copilotRequestStops.userId, scope.userId],
      [copilotRequestStops.workspaceId, scope.workspaceId],
      [copilotRequestStops.streamId, scope.streamId],
    ]) {
      expect(
        hasMockCondition(
          dbChainMockFns.where.mock.calls[0]?.[0],
          (condition) =>
            condition.type === 'eq' && condition.left === column && condition.right === value
        )
      ).toBe(true)
    }
  })

  it('resolves a missing workspace from the actor-owned chat before checking Stop', async () => {
    queueTableRows(copilotChats, [{ workspaceId: scope.workspaceId }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'run-1', status: 'active' }])
    await createRunSegment({ ...input, workspaceId: undefined })
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: scope.workspaceId, status: 'active' })
    )
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[0]?.[0],
        (condition) =>
          condition.type === 'eq' &&
          condition.left === copilotChats.userId &&
          condition.right === scope.userId
      )
    ).toBe(true)
  })

  it('refuses admission when its canonical workspace cannot be resolved', async () => {
    await expect(createRunSegment({ ...input, workspaceId: undefined })).rejects.toThrow(
      'Chat workspace is unavailable'
    )
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('does not acknowledge a failed Stop transaction or continue after a failed admission', async () => {
    dbChainMockFns.execute.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(stopPendingRequest(scope)).rejects.toThrow('database unavailable')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    await expect(createRunSegment(input)).rejects.toThrow('persisted identity')
  })
})

describe('durable Sim tool ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })
  const input = { toolCallId: 'tool-1', runId: 'run-1', userId: 'user-1' }

  it.each(['complete', 'error', 'cancelled'] as const)(
    'closes %s admission and refuses preexisting terminal rows',
    async (status) => {
      await updateRunStatus(input.runId, status)
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({ status, toolAdmissionClosedAt: expect.anything() })
      )
      expect(
        hasMockCondition(
          dbChainMockFns.where.mock.calls[0]?.[0],
          (condition) => condition.type === 'notInArray' && condition.column === copilotRuns.status
        )
      ).toBe(true)
      dbChainMockFns.for.mockResolvedValueOnce([
        { toolExecutionVersion: 2, toolAdmissionClosedAt: null, status },
      ])
      expect(await claimSimToolExecution(input)).toEqual({ outcome: 'closed' })
      dbChainMockFns.for.mockResolvedValueOnce([{ version: 2, closedAt: null, status }])
      await expect(
        recordSimSandboxProcess({
          ...input,
          process: { id: 'command-1', sandboxId: 'sandbox-1', sessionKey: 'chat:1' },
        })
      ).rejects.toThrow('admission is closed')
      expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    }
  )

  it('locks the actor-owned run before claiming a still-unclaimed execution', async () => {
    expect(copilotRuns.toolExecutionVersion).toBeDefined()
    expect(copilotRuns.toolAdmissionClosedAt).toBeDefined()
    expect(copilotAsyncToolCalls.executionStartedAt).toBeDefined()
    expect(copilotAsyncToolCalls.executionSettledAt).toBeDefined()
    dbChainMockFns.for.mockResolvedValueOnce([
      { id: input.runId, toolExecutionVersion: 2, toolAdmissionClosedAt: null },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'row-1' }])
    expect(await claimSimToolExecution(input)).toEqual({ outcome: 'claimed' })
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[0]?.[0],
        (condition) => condition.type === 'eq' && condition.right === input.userId
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[1]?.[0],
        (condition) =>
          condition.type === 'isNull' &&
          condition.column === copilotAsyncToolCalls.executionStartedAt
      )
    ).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ executionStartedAt: expect.any(Date), status: 'running' })
    )
  })

  it('refuses admission after Stop without touching any tool row', async () => {
    dbChainMockFns.for.mockResolvedValueOnce([
      { toolExecutionVersion: 2, toolAdmissionClosedAt: new Date() },
    ])
    expect(await claimSimToolExecution(input)).toEqual({ outcome: 'closed' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it.each([0, 1])('does not certify or execute through tracking version %s', async (version) => {
    dbChainMockFns.for.mockResolvedValueOnce([{ toolExecutionVersion: version }])
    await expect(claimSimToolExecution(input)).rejects.toThrow('ownership is unavailable')
    dbChainMockFns.returning.mockResolvedValueOnce([{ version }])
    expect(await closeStreamToolAdmission('stream-1', input.userId)).toBe(false)
  })

  it('returns an existing outcome without taking its execution ownership', async () => {
    dbChainMockFns.for.mockResolvedValueOnce([{ toolExecutionVersion: 2 }])
    dbChainMockFns.returning.mockResolvedValueOnce([])
    const record = {
      toolCallId: input.toolCallId,
      status: 'failed',
      executionStartedAt: new Date(),
      executionSettledAt: null,
    }
    queueTableRows(copilotAsyncToolCalls, [record])
    expect(await claimSimToolExecution(input)).toEqual({ outcome: 'existing' })
  })

  it('keeps a terminal result distinct from actual execution settlement', async () => {
    queueTableRows(copilotRuns, [{ id: input.runId }])
    queueTableRows(copilotAsyncToolCalls, [{ id: 'still-owned' }])
    expect(await areStreamToolExecutionsSettled('stream-1', input.userId)).toBe(false)
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'row-1' }])
    await settleSimToolExecution(input.toolCallId)
    expect(dbChainMockFns.set).toHaveBeenLastCalledWith({ executionSettledAt: expect.any(Date) })
  })

  it('requires a tracked closed run even when no tool rows were returned', async () => {
    expect(await areStreamToolExecutionsSettled('stream-1', input.userId)).toBe(false)
    queueTableRows(copilotRuns, [{ id: input.runId }])
    expect(await areStreamToolExecutionsSettled('stream-1', input.userId)).toBe(true)
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[1]?.[0],
        (condition) => condition.type === 'eq' && condition.right === input.userId
      )
    ).toBe(true)
  })

  it('records a command identity only under the live actor-owned run lock', async () => {
    expect(copilotAsyncToolCalls.sandboxProcesses).toBeDefined()
    dbChainMockFns.for.mockResolvedValueOnce([{ version: 2, closedAt: null }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'tool-row' }])
    await recordSimSandboxProcess({
      ...input,
      process: { id: 'process-1', sandboxId: 'sandbox-1', sessionKey: 'chat-1' },
    })
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[0]?.[0],
        (condition) => condition.type === 'eq' && condition.right === input.userId
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[1]?.[0],
        (condition) => condition.type === 'eq' && condition.right === input.runId
      )
    ).toBe(true)
  })

  it('refuses another command within a running tool after Stop closes admission', async () => {
    dbChainMockFns.for.mockResolvedValueOnce([{ version: 2, closedAt: new Date() }])
    await expect(
      recordSimSandboxProcess({
        ...input,
        process: { id: 'process-1', sandboxId: 'sandbox-1', sessionKey: 'chat-1' },
      })
    ).rejects.toThrow('admission is closed')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('returns only unresolved command identities and retains their tool owners', async () => {
    queueTableRows(copilotAsyncToolCalls, [
      {
        toolCallId: input.toolCallId,
        processes: {
          unresolved: { sandboxId: 'sandbox-1', sessionKey: 'chat-1', settled: false },
          finished: { sandboxId: 'sandbox-1', sessionKey: 'chat-1', settled: true },
        },
      },
    ])
    expect(await getUnsettledStreamSandboxProcesses('stream-1', input.userId)).toEqual([
      {
        toolCallId: input.toolCallId,
        id: 'unresolved',
        sandboxId: 'sandbox-1',
        sessionKey: 'chat-1',
      },
    ])
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[0]?.[0],
        (condition) => condition.type === 'eq' && condition.right === input.userId
      )
    ).toBe(true)
  })

  it('refuses to manufacture settlement for a command absent from the tool record', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(settleSimSandboxProcess(input.toolCallId, 'unknown')).rejects.toThrow(
      'settlement could not be recorded'
    )
  })
})

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
    expect(dbChainMockFns.set.mock.calls[0]?.[0]).not.toHaveProperty('executionSettledAt')
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
    queueTableRows(copilotRuns, [{ version: 2, status: 'active', closedAt: null }])
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        toolCallId: 'workflow-tool',
        status: 'running',
        claimedBy: 'workflow:execution-1',
      },
    ])

    const result = await claimWorkflowToolExecution('workflow-tool', 'execution-1', 'client')

    expect(result).toMatchObject({
      toolCallId: 'workflow-tool',
      claimedBy: 'workflow:execution-1',
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      status: expect.anything(),
      claimedBy: 'workflow:execution-1',
      claimedAt: expect.any(Date),
      executionStartedAt: expect.any(Date),
      clientWorkflowExecutionId: 'execution-1',
      updatedAt: expect.any(Date),
    })
    expect(getClaimedWorkflowExecutionId(result?.claimedBy)).toBe('execution-1')
  })

  it('returns null when a workflow tool execution claim loses the race', async () => {
    queueTableRows(copilotRuns, [{ version: 2, status: 'active', closedAt: null }])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      claimWorkflowToolExecution('workflow-tool', 'execution-2', 'client')
    ).resolves.toBeNull()
  })

  it.each([
    { version: 2, status: 'active', closedAt: new Date() },
    { version: 2, status: 'cancelled', closedAt: null },
    { version: 2, status: 'complete', closedAt: null },
    { version: 2, status: 'error', closedAt: null },
    { version: 0, status: 'active', closedAt: null },
  ])('refuses workflow pickup without active parent admission: %j', async (run) => {
    queueTableRows(copilotRuns, [run])
    await expect(
      claimWorkflowToolExecution('workflow-tool', 'execution-2', 'client')
    ).resolves.toBeNull()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
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
})
