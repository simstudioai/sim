/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getTableById, loadWorkspace } = vi.hoisted(() => ({
  getTableById: vi.fn(),
  loadWorkspace: vi.fn(),
}))

vi.mock('@/lib/table', () => ({ getTableById }))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: loadWorkspace,
}))

import { resolveActiveTableContext } from '@/lib/table/application/context'

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

/**
 * Holds the table load open so a test can observe what the resolver does before
 * the table arrives. `release` resolves it with the canonical table.
 */
function deferTableLoad(): { release: () => void } {
  let releaseTable: (table: unknown) => void = () => {}
  getTableById.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseTable = resolve
      })
  )
  return {
    release: () => releaseTable({ id: 'table-1', workspaceId: 'workspace-1', name: 'Contacts' }),
  }
}

describe('table application context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('starts the workspace load without waiting for the table when a workspace is asserted', async () => {
    const { release } = deferTableLoad()

    const pending = resolveActiveTableContext({
      tableId: 'table-1',
      assertedWorkspaceId: 'workspace-1',
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(loadWorkspace).toHaveBeenCalledWith('workspace-1')

    release()
    await expect(pending).resolves.toMatchObject({ tableId: 'table-1', workspaceId: 'workspace-1' })
  })

  it('waits for the table before loading a workspace when none is asserted', async () => {
    const { release } = deferTableLoad()

    const pending = resolveActiveTableContext({ tableId: 'table-1' })
    await Promise.resolve()
    await Promise.resolve()

    expect(loadWorkspace).not.toHaveBeenCalled()

    release()
    await expect(pending).resolves.toMatchObject({ tableId: 'table-1', workspaceId: 'workspace-1' })
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

  it('conceals a missing table with no asserted workspace', async () => {
    getTableById.mockResolvedValueOnce(null)

    await expect(resolveActiveTableContext({ tableId: 'missing' })).rejects.toMatchObject({
      code: 'not_found',
      message: expect.stringContaining('not found in this workspace'),
    })
    expect(loadWorkspace).not.toHaveBeenCalled()
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

  it('surfaces not_found rather than a failing table load on a matched assertion', async () => {
    const failure = new Error('table database unavailable')
    getTableById.mockRejectedValueOnce(failure)

    const unhandled = await withUnhandledRejectionWatch(async () => {
      await expect(
        resolveActiveTableContext({ tableId: 'table-1', assertedWorkspaceId: 'workspace-1' })
      ).rejects.toBe(failure)
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

  it('fails when the canonical workspace is unavailable on the asserted path', async () => {
    loadWorkspace.mockResolvedValueOnce(null)

    await expect(
      resolveActiveTableContext({ tableId: 'table-1', assertedWorkspaceId: 'workspace-1' })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Workspace not found' })
  })

  it('propagates canonical workspace database failures', async () => {
    const failure = new Error('workspace database unavailable')
    loadWorkspace.mockRejectedValueOnce(failure)

    await expect(resolveActiveTableContext({ tableId: 'table-1' })).rejects.toBe(failure)
  })

  it('propagates canonical workspace database failures on the asserted path', async () => {
    const failure = new Error('workspace database unavailable')
    loadWorkspace.mockRejectedValueOnce(failure)

    const unhandled = await withUnhandledRejectionWatch(async () => {
      await expect(
        resolveActiveTableContext({ tableId: 'table-1', assertedWorkspaceId: 'workspace-1' })
      ).rejects.toBe(failure)
    })

    expect(unhandled).toEqual([])
  })
})
