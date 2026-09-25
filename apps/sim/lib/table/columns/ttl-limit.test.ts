import { tableServiceMock, tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
import {
  tableTtlAvailabilityMock,
  tableTtlAvailabilityMockFns,
} from '@sim/testing/mocks/table-ttl-availability.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition, TableLocks } from '@/lib/table/types'

const { mockTimeoutExecute } = vi.hoisted(() => ({
  mockTimeoutExecute: vi.fn(),
}))

vi.mock('@/lib/table/service', () => tableServiceMock)
vi.mock('@/lib/table/ttl-availability', () => tableTtlAvailabilityMock)

import { addTableColumn } from '@/lib/table/columns/service'

const mockWithLockedTable = tableServiceMockFns.mockWithLockedTable
const mockAssertTableRowTtlEnabled = tableTtlAvailabilityMockFns.mockAssertTableRowTtlEnabled

const UNLOCKED: TableLocks = {
  schemaLocked: false,
  insertLocked: false,
  updateLocked: false,
  deleteLocked: false,
}

function makeTable(): TableDefinition {
  return {
    id: 'table-1',
    name: 'Tasks',
    schema: {
      columns: [
        { id: 'col-name', name: 'name', type: 'string' },
        { id: 'col-ttl', name: 'expires_at', type: 'ttl' },
      ],
    },
    rowCount: 0,
    maxRows: 100,
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    locks: UNLOCKED,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

const transaction = new Proxy(
  { execute: mockTimeoutExecute },
  {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target]
      throw new Error(`Unexpected transaction method: ${String(property)}`)
    },
  }
)

describe('TTL column mutation limit', () => {
  beforeEach(() => {
    mockAssertTableRowTtlEnabled.mockResolvedValue(undefined)
    mockTimeoutExecute.mockResolvedValue([])
    mockWithLockedTable.mockImplementation(async (_tableId, mutate) =>
      mutate(makeTable(), transaction)
    )
  })

  it('rejects adding a TTL column before locking when the feature is disabled', async () => {
    mockAssertTableRowTtlEnabled.mockRejectedValue(new Error('Expiration columns are not enabled'))

    await expect(
      addTableColumn('table-1', { name: 'expiry', type: 'ttl' }, 'request-1')
    ).rejects.toThrow('Expiration columns are not enabled')
    expect(mockWithLockedTable).not.toHaveBeenCalled()
  })

  it('rejects adding a second TTL column before persistence', async () => {
    await expect(
      addTableColumn('table-1', { name: 'another_expiry', type: 'ttl' }, 'request-1')
    ).rejects.toThrow('A table can have at most 1 Expiration column')
  })
})
