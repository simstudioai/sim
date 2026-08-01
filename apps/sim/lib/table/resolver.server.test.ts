/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPersistedTableById, mockGetVirtualTableById } = vi.hoisted(() => ({
  mockGetPersistedTableById: vi.fn(),
  mockGetVirtualTableById: vi.fn(),
}))

vi.mock('@/lib/table/service', () => ({
  getTableById: mockGetPersistedTableById,
}))

vi.mock('@/lib/virtual-tables/service.server', () => ({
  getVirtualTableById: mockGetVirtualTableById,
}))

import { resolveTableById } from '@/lib/table/resolver.server'

describe('table resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a virtual definition without querying persisted definitions', async () => {
    const table = { id: 'system_memory_workspace-1' }
    mockGetVirtualTableById.mockResolvedValue(table)

    await expect(resolveTableById(table.id)).resolves.toBe(table)
    expect(mockGetPersistedTableById).not.toHaveBeenCalled()
  })

  it('falls back to persisted definitions', async () => {
    const table = { id: 'table-1' }
    mockGetVirtualTableById.mockResolvedValue(null)
    mockGetPersistedTableById.mockResolvedValue(table)

    await expect(resolveTableById(table.id)).resolves.toBe(table)
    expect(mockGetPersistedTableById).toHaveBeenCalledWith(table.id)
  })
})
