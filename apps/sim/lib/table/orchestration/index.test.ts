/**
 * @vitest-environment node
 *
 * `restoreTable` calls `assertResourceMutable('table', tableId)` before restoring --
 * this correctly evaluates both the table's own `locked` flag and its (unchanged on
 * restore) containing folder chain, since restore doesn't change folderId. Guards
 * that a `ResourceLockedError` thrown from `restoreTable` surfaces through
 * `performRestoreTable` as `errorCode: 'locked'` (423).
 */
import { ResourceLockedError } from '@sim/platform-authz/resource-lock'
import { auditMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetTableById, mockRestoreTable } = vi.hoisted(() => ({
  mockGetTableById: vi.fn(),
  mockRestoreTable: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/table/service', () => {
  class TableConflictErrorStub extends Error {}
  return {
    getTableById: mockGetTableById,
    restoreTable: mockRestoreTable,
    TableConflictError: TableConflictErrorStub,
  }
})

import { performRestoreTable } from '@/lib/table/orchestration'

describe('performRestoreTable — resource-lock enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue({ id: 'tbl-1', name: 'Table 1', workspaceId: 'ws-1' })
  })

  it('returns a 423 (locked) when the table itself is directly locked', async () => {
    mockRestoreTable.mockRejectedValueOnce(
      new ResourceLockedError('table', false, 'Table is locked')
    )

    const result = await performRestoreTable({ tableId: 'tbl-1', userId: 'user-1' })

    expect(result).toMatchObject({ success: false, errorCode: 'locked' })
  })

  it('returns a 423 (locked, inherited) when the table is restored into a folder that is now locked', async () => {
    mockRestoreTable.mockRejectedValueOnce(
      new ResourceLockedError('table', true, 'Table is locked by its containing folder')
    )

    const result = await performRestoreTable({ tableId: 'tbl-1', userId: 'user-1' })

    expect(result).toMatchObject({ success: false, errorCode: 'locked' })
  })

  it('restores successfully when unlocked', async () => {
    mockRestoreTable.mockResolvedValueOnce(undefined)
    mockGetTableById
      .mockResolvedValueOnce({ id: 'tbl-1', name: 'Table 1', workspaceId: 'ws-1' })
      .mockResolvedValueOnce({ id: 'tbl-1', name: 'Table 1', workspaceId: 'ws-1' })

    const result = await performRestoreTable({ tableId: 'tbl-1', userId: 'user-1' })

    expect(result.success).toBe(true)
    expect(mockRestoreTable).toHaveBeenCalledWith('tbl-1', expect.any(String))
  })
})
