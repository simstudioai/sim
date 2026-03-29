/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSelectLimit, mockUpdateSet, mockUpdateWhere, mockUpdateReturning } = vi.hoisted(() => ({
  mockSelectLimit: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockUpdateReturning: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mockSelectLimit,
        }),
      }),
    }),
    update: () => ({
      set: mockUpdateSet,
    }),
    insert: vi.fn(),
  },
}))

mockUpdateSet.mockImplementation(() => ({
  where: mockUpdateWhere,
}))

mockUpdateWhere.mockImplementation(() => ({
  returning: mockUpdateReturning,
}))

import {
  claimCompletedAsyncToolCall,
  completeAsyncToolCall,
  markAsyncToolDelivered,
} from './repository'

describe('async tool repository single-row semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not overwrite a delivered row on late completion', async () => {
    const deliveredRow = {
      toolCallId: 'tool-1',
      status: 'delivered',
      result: { ok: true },
      error: null,
    }
    mockSelectLimit.mockResolvedValueOnce([deliveredRow])

    const result = await completeAsyncToolCall({
      toolCallId: 'tool-1',
      status: 'completed',
      result: { ok: false },
      error: null,
    })

    expect(result).toEqual(deliveredRow)
    expect(mockUpdateReturning).not.toHaveBeenCalled()
  })

  it('marks a row delivered and clears the claim fields', async () => {
    mockUpdateReturning.mockResolvedValueOnce([
      {
        toolCallId: 'tool-1',
        status: 'delivered',
      },
    ])

    await markAsyncToolDelivered('tool-1')

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'delivered',
        claimedBy: null,
        claimedAt: null,
      })
    )
  })

  it('claims only completed rows for delivery handoff', async () => {
    mockUpdateReturning.mockResolvedValueOnce([
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
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        claimedBy: 'worker-1',
      })
    )
  })
})
