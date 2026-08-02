/**
 * @vitest-environment node
 */

import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claimCompletedAsyncToolCall,
  claimPendingAsyncToolCall,
  completeAsyncToolCall,
  detachAsyncToolCall,
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

  it('keeps the first finalized pending call identity immutable', async () => {
    const pendingRow = {
      runId: 'run-1',
      toolCallId: 'tool-1',
      toolName: 'function_execute',
      args: { language: 'javascript', code: 'return {{FIRST_SECRET}}' },
      status: 'pending',
    }
    dbChainMockFns.limit.mockResolvedValueOnce([pendingRow])

    const result = await upsertAsyncToolCall({
      runId: 'run-1',
      toolCallId: 'tool-1',
      toolName: 'function_execute',
      args: { language: 'javascript', code: 'return {{SECOND_SECRET}}' },
      status: 'pending',
    })

    expect(result).toEqual(pendingRow)
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })
})
