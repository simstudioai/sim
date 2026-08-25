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

import {
  resolveActiveTableContext,
  resolveArchivedTableContext,
} from '@/lib/table/application/context'

/**
 * Copilot tool invocations as they appear in prose: a `glob(...)`/`grep(...)` call, or a
 * bare `table_*` / `save_upload` tool name. `save_upload` matches WITHOUT a trailing paren
 * because the remediation text that had to go named it as a tool, not as a call — requiring
 * the paren let that exact string back in. Bare `read` is deliberately absent: `read(`
 * matches ordinary stream code. Still narrow enough that SQL identifiers
 * (`user_table_rows`) do not trip it.
 */
const COPILOT_TOOL_REFERENCE =
  /\b(?:glob|grep)\(|\bsave_upload\b|\btable_(?:views|rows|columns|metadata)\b(?!\.)/

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

/**
 * Restore is the one table operation whose subject is deliberately archived, so
 * it needs a resolver the active one cannot provide — while keeping the same
 * cross-workspace concealment.
 */
describe('resolveArchivedTableContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('reports a table id that resolves to nothing as not found', async () => {
    getTableById.mockResolvedValue(null)

    await expect(
      resolveArchivedTableContext({ tableId: 'ghost', assertedWorkspaceId: 'workspace-1' })
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})

/**
 * Table errors reach a CLI, an HTTP client and Copilot alike, so their remediation
 * must describe an ACTION every caller can take. Naming a Copilot tool (`glob(...)`,
 * `table_views`, `save_upload`) turns the advice into noise — or a dead end — for the
 * other two.
 */
describe('surface-neutral remediation text', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // `clearAllMocks` drops call history but keeps implementations, so without an explicit
    // reset this block would inherit whichever `mockResolvedValue` the previous describe
    // happened to leave behind — the state these assertions depend on.
    getTableById.mockReset()
    loadWorkspace.mockReset()
    loadWorkspace.mockImplementation(async (workspaceId: string) =>
      workspaceId === 'workspace-1' ? WORKSPACE_ONE : WORKSPACE_TWO
    )
  })

  it('tells a caller to list tables without naming a Copilot tool', async () => {
    getTableById.mockResolvedValue(null)

    await expect(
      resolveActiveTableContext({ tableId: 'missing', assertedWorkspaceId: 'workspace-1' })
    ).rejects.toMatchObject({
      code: 'not_found',
      message: expect.stringContaining('List the tables in this workspace'),
    })

    const [error] = await resolveActiveTableContext({ tableId: 'missing' }).catch((err) => [err])
    expect((error as Error).message).not.toMatch(COPILOT_TOOL_REFERENCE)
  })

  it('names no Copilot tool anywhere under lib/table', async () => {
    const { readdir, readFile } = await import('node:fs/promises')
    const root = new URL('../', import.meta.url).pathname
    const offenders: string[] = []

    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = `${dir}${entry.name}${entry.isDirectory() ? '/' : ''}`
        if (entry.isDirectory()) {
          await walk(full)
          continue
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue
        const source = await readFile(full, 'utf8')
        for (const line of source.split('\n')) {
          const trimmed = line.trim()
          if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue
          if (!line.includes("'") && !line.includes('`')) continue
          if (COPILOT_TOOL_REFERENCE.test(line)) offenders.push(`${entry.name}: ${line.trim()}`)
        }
      }
    }

    await walk(root)
    expect(offenders).toEqual([])
  })
})
