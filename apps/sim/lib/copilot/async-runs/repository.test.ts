/**
 * @vitest-environment node
 */

import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

import {
  claimCompletedAsyncToolCall,
  completeAsyncToolCall,
  markAsyncToolDelivered,
} from './repository'

describe('async tool repository single-row semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('does not overwrite a delivered row on late completion', async () => {
    const deliveredRow = {
      toolCallId: 'tool-1',
      status: 'delivered',
      result: { ok: true },
      error: null,
    }
    dbChainMockFns.limit.mockResolvedValueOnce([deliveredRow])

    const result = await completeAsyncToolCall({
      toolCallId: 'tool-1',
      status: 'completed',
      result: { ok: false },
      error: null,
    })

    expect(result).toEqual(deliveredRow)
    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
  })

  it('marks a row delivered and clears the claim fields', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        toolCallId: 'tool-1',
        status: 'delivered',
      },
    ])

    await markAsyncToolDelivered('tool-1')

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'delivered',
        claimedBy: null,
        claimedAt: null,
      })
    )
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
})
