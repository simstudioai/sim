import { tableServiceMock, tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/table/service', () => tableServiceMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

import {
  resolveActiveTableContext,
  resolveArchivedTableContext,
} from '@/lib/table/application/context'

const getTableById = tableServiceMockFns.mockGetTableById
const loadWorkspace = workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext

const WORKSPACE_ONE = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-user-1',
}

const WORKSPACE_TWO = {
  workspaceId: 'workspace-2',
  workspaceOrganizationId: 'organization-2',
  allowPersonalApiKeys: false,
  billedAccountUserId: 'billing-user-2',
}

/** Runs `body` while capturing any unhandled promise rejection it provokes. */
async function withUnhandledRejectionWatch(body: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = []
  const onUnhandled = (reason: unknown) => {
    seen.push(reason)
  }
  process.on('unhandledRejection', onUnhandled)
  try {
    await body()
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
  return seen
}

describe('table application context', () => {
  beforeEach(() => {
    getTableById.mockResolvedValue({
      id: 'table-1',
      workspaceId: 'workspace-1',
      name: 'Contacts',
    })
    loadWorkspace.mockImplementation(async (workspaceId: string) =>
      workspaceId === 'workspace-1' ? WORKSPACE_ONE : WORKSPACE_TWO
    )
  })

  it('derives workspace scope from the canonical active table', async () => {
    await expect(
      resolveActiveTableContext({ tableId: 'table-1', assertedWorkspaceId: 'workspace-1' })
    ).resolves.toMatchObject({
      tableId: 'table-1',
      workspaceId: 'workspace-1',
      billedAccountUserId: 'billing-user-1',
    })
    expect(getTableById).toHaveBeenCalledWith('table-1')
    expect(loadWorkspace).toHaveBeenCalledWith('workspace-1')
  })

  it('conceals an asserted cross-workspace table as not found', async () => {
    await expect(
      resolveActiveTableContext({ tableId: 'table-1', assertedWorkspaceId: 'workspace-2' })
    ).rejects.toMatchObject({
      code: 'not_found',
      message: expect.stringContaining('not found in this workspace'),
    })
  })

  it('conceals a table that does not exist at all', async () => {
    getTableById.mockResolvedValueOnce(null)

    await expect(
      resolveActiveTableContext({ tableId: 'missing', assertedWorkspaceId: 'workspace-1' })
    ).rejects.toMatchObject({
      code: 'not_found',
      message: expect.stringContaining('not found in this workspace'),
    })
  })

  it('surfaces not_found rather than a failing workspace load on a mismatched assertion', async () => {
    const failure = new Error('workspace database unavailable')
    loadWorkspace.mockRejectedValueOnce(failure)

    const unhandled = await withUnhandledRejectionWatch(async () => {
      await expect(
        resolveActiveTableContext({ tableId: 'table-1', assertedWorkspaceId: 'workspace-2' })
      ).rejects.toMatchObject({
        code: 'not_found',
        message: expect.stringContaining('not found in this workspace'),
      })
    })

    expect(unhandled).toEqual([])
  })

  it('refuses a workspace context that is not the canonical workspace of the table', async () => {
    loadWorkspace.mockResolvedValueOnce(WORKSPACE_TWO)

    await expect(
      resolveActiveTableContext({ tableId: 'table-1', assertedWorkspaceId: 'workspace-1' })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Table not found' })
  })

  it('fails when the canonical workspace is unavailable', async () => {
    loadWorkspace.mockResolvedValueOnce(null)

    await expect(resolveActiveTableContext({ tableId: 'table-1' })).rejects.toMatchObject({
      code: 'not_found',
      message: 'Workspace not found',
    })
  })

  it('propagates canonical workspace database failures', async () => {
    const failure = new Error('workspace database unavailable')
    loadWorkspace.mockRejectedValueOnce(failure)

    await expect(resolveActiveTableContext({ tableId: 'table-1' })).rejects.toBe(failure)
  })
})

/**
 * Restore is the one table operation whose subject is deliberately archived, so
 * it needs a resolver the active one cannot provide — while keeping the same
 * cross-workspace concealment.
 */
describe('resolveArchivedTableContext', () => {
  beforeEach(() => {
    loadWorkspace.mockResolvedValue(WORKSPACE_ONE)
  })

  it('loads a table the active resolver would report as missing', async () => {
    const archived = {
      id: 'table-1',
      workspaceId: 'workspace-1',
      archivedAt: new Date('2026-01-01'),
    }
    getTableById.mockResolvedValue(archived)

    const context = await resolveArchivedTableContext({
      tableId: 'table-1',
      assertedWorkspaceId: 'workspace-1',
    })

    expect(getTableById).toHaveBeenCalledWith('table-1', { includeArchived: true })
    expect(context.table).toBe(archived)
    expect(context.workspaceId).toBe('workspace-1')
  })

  it('conceals an archived table in another workspace as not found', async () => {
    getTableById.mockResolvedValue({
      id: 'table-1',
      workspaceId: 'workspace-2',
      archivedAt: new Date('2026-01-01'),
    })

    await expect(
      resolveArchivedTableContext({ tableId: 'table-1', assertedWorkspaceId: 'workspace-1' })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(loadWorkspace).not.toHaveBeenCalled()
  })
})
