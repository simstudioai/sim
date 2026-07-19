import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockTransaction, mockSelect, mockUpdateSet, mockDeleteWhere } = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockDeleteWhere: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    transaction: mockTransaction,
  },
}))

import { abortPreviewCandidate, promotePreviewCandidate } from '@/lib/apps/pins'

function arrangeActiveSessions(
  rows: Array<{ id: string; lifecycle: 'primary' | 'candidate' | 'displaced' }>
) {
  mockSelect
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          for: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ id: 'project-1' }]) })),
        })),
      })),
    })
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(rows),
      })),
    })
}

describe('preview candidate promotion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateSet.mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) }))
    mockDeleteWhere.mockResolvedValue(undefined)
    mockTransaction.mockImplementation(async (callback) =>
      callback({
        select: mockSelect,
        update: vi.fn(() => ({ set: mockUpdateSet })),
        delete: vi.fn(() => ({ where: mockDeleteWhere })),
      })
    )
  })

  it('stops the displaced session only when the candidate is promoted', async () => {
    arrangeActiveSessions([
      { id: 'old-session', lifecycle: 'displaced' },
      { id: 'candidate-session', lifecycle: 'candidate' },
    ])

    await expect(
      promotePreviewCandidate({
        projectId: 'project-1',
        userId: 'user-1',
        sessionId: 'candidate-session',
      })
    ).resolves.toEqual({ ok: true })

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ stoppedAt: expect.any(Date), buildId: null })
    )
    expect(mockUpdateSet).toHaveBeenCalledWith({ lifecycle: 'primary' })
    expect(mockDeleteWhere).toHaveBeenCalledTimes(1)
  })

  it('aborts the candidate and restores the displaced session', async () => {
    arrangeActiveSessions([
      { id: 'old-session', lifecycle: 'displaced' },
      { id: 'candidate-session', lifecycle: 'candidate' },
    ])

    await expect(
      abortPreviewCandidate({
        projectId: 'project-1',
        userId: 'user-1',
        sessionId: 'candidate-session',
      })
    ).resolves.toEqual({ ok: true })

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ stoppedAt: expect.any(Date), buildId: null })
    )
    expect(mockUpdateSet).toHaveBeenCalledWith({ lifecycle: 'primary' })
    expect(mockDeleteWhere).toHaveBeenCalledTimes(1)
  })
})
