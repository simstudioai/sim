/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getTableById, select } = vi.hoisted(() => ({
  getTableById: vi.fn(),
  select: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: { select } }))
vi.mock('@/lib/table', () => ({ getTableById }))

import { resolveActiveTableContext } from '@/lib/table/application/context'

function mockWorkspaceQuery(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows)
  const where = vi.fn(() => ({ limit }))
  const from = vi.fn(() => ({ where }))
  select.mockReturnValue({ from })
  return { from, where, limit }
}

describe('table application context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getTableById.mockResolvedValue({
      id: 'table-1',
      workspaceId: 'workspace-1',
      name: 'Contacts',
    })
  })

  it('derives workspace scope from the canonical active table', async () => {
    mockWorkspaceQuery([
      {
        workspaceId: 'workspace-1',
        workspaceOrganizationId: 'organization-1',
        allowPersonalApiKeys: true,
        billedAccountUserId: 'billing-user-1',
      },
    ])

    await expect(
      resolveActiveTableContext({ tableId: 'table-1', assertedWorkspaceId: 'workspace-1' })
    ).resolves.toMatchObject({
      tableId: 'table-1',
      workspaceId: 'workspace-1',
      billedAccountUserId: 'billing-user-1',
    })
    expect(getTableById).toHaveBeenCalledWith('table-1')
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('conceals an asserted cross-workspace table before workspace resolution', async () => {
    await expect(
      resolveActiveTableContext({ tableId: 'table-1', assertedWorkspaceId: 'workspace-2' })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Table not found' })
    expect(select).not.toHaveBeenCalled()
  })

  it('fails when the canonical workspace is unavailable', async () => {
    mockWorkspaceQuery([])

    await expect(resolveActiveTableContext({ tableId: 'table-1' })).rejects.toMatchObject({
      code: 'not_found',
      message: 'Workspace not found',
    })
  })
})
