import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSelect, mockTransaction, mockUpdateWhere, mockDeleteWhere } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockTransaction: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockDeleteWhere: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
    transaction: mockTransaction,
  },
}))

import { stopActivePreviewSessionsForProject } from '@/lib/apps/pins'

describe('preview pin teardown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ id: 'session-1' }, { id: 'session-2' }]),
      })),
    })
    mockUpdateWhere.mockResolvedValue(undefined)
    mockDeleteWhere.mockResolvedValue(undefined)
    mockTransaction.mockImplementation(async (callback) =>
      callback({
        update: vi.fn(() => ({
          set: vi.fn(() => ({ where: mockUpdateWhere })),
        })),
        delete: vi.fn(() => ({ where: mockDeleteWhere })),
      })
    )
  })

  it('stops every active session and removes its retention pins', async () => {
    await expect(stopActivePreviewSessionsForProject('project-1')).resolves.toBe(2)

    expect(mockTransaction).toHaveBeenCalledTimes(2)
    expect(mockUpdateWhere).toHaveBeenCalledTimes(2)
    expect(mockDeleteWhere).toHaveBeenCalledTimes(2)
  })
})
