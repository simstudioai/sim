/**
 * @vitest-environment node
 */

import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { createTableDefinition } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createRows: vi.fn(),
  queryRows: vi.fn(),
  updateRow: vi.fn(),
  updateTable: vi.fn(),
  listFolders: vi.fn(),
  deleteFolder: vi.fn(),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  restoreFolder: vi.fn(),
}))

vi.mock('@/lib/table/application/rows', () => ({
  createTableRows: { execute: mocks.createRows },
  deleteTableRow: { execute: vi.fn() },
  deleteTableRows: { execute: vi.fn() },
  queryTableRows: { execute: mocks.queryRows },
  readTableRow: { execute: vi.fn() },
  updateTableRow: { execute: mocks.updateRow },
  updateTableRows: { execute: vi.fn() },
  upsertTableRow: { execute: vi.fn() },
}))

vi.mock('@/lib/table/application/tables', () => ({
  createTableUseCase: { execute: vi.fn() },
  listTableDefinitionsUseCase: { execute: vi.fn() },
  readTableDetailsUseCase: { execute: vi.fn() },
  updateTableUseCase: { execute: mocks.updateTable },
}))

vi.mock('@/lib/table/application/folders', () => ({
  listTableFoldersUseCase: { execute: mocks.listFolders },
  createTableFolderUseCase: { execute: mocks.createFolder },
  updateTableFolderUseCase: { execute: mocks.updateFolder },
  deleteTableFolderUseCase: { execute: mocks.deleteFolder },
  restoreTableFolderUseCase: { execute: mocks.restoreFolder },
}))

import {
  executeTableCreateFolder,
  executeTableDeleteFolder,
  executeTableInsertRows,
  executeTableListFolders,
  executeTableMove,
  executeTableQueryRows,
  executeTableRestoreFolder,
  executeTableUpdateFolder,
  executeTableUpdateRow,
  type TableToolOperationContext,
} from '@/lib/internal/table/operations'

const PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-canonical',
  delegationId: 'delegation-1',
  audience: 'sim:tables',
  issuedAt: new Date('2026-08-27T00:00:00.000Z'),
  expiresAt: new Date('2026-08-27T00:05:00.000Z'),
  resourceScope: { tableId: 'table-1' },
  delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
}

const TABLE = createTableDefinition({
  id: 'table-1',
  workspaceId: 'workspace-canonical',
  columns: [{ id: 'column-1', name: 'Email', type: 'string' }],
})

const ROW = {
  id: 'row-1',
  data: { 'column-1': 'a@example.com' },
  position: 0,
  orderKey: 'a0',
  createdAt: new Date('2026-08-27T00:00:00.000Z'),
  updatedAt: new Date('2026-08-27T00:00:00.000Z'),
}

function operationContext(): TableToolOperationContext {
  return {
    principal: PRINCIPAL,
    headers: new Headers(),
    requestId: 'request-1',
  }
}

describe('Table direct operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createRows.mockResolvedValue({ kind: 'single', table: TABLE, row: ROW })
    mocks.updateRow.mockResolvedValue({ table: TABLE, row: ROW, changed: true })
    mocks.queryRows.mockResolvedValue({
      table: TABLE,
      rows: [ROW],
      rowCount: 1,
      totalCount: 1,
      limit: 10,
      offset: 0,
      nextCursor: null,
    })
  })

  it('uses canonical principal workspace instead of the prepared body assertion', async () => {
    await executeTableUpdateRow(
      'table-1',
      'row-1',
      { workspaceId: 'workspace-forged', data: { Email: 'a@example.com' } },
      operationContext()
    )

    expect(mocks.updateRow).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        tableId: 'table-1',
        rowId: 'row-1',
        assertedWorkspaceId: 'workspace-canonical',
        dataKeying: 'names',
        strictWrite: false,
        secretProvenanceEnvelope: { kind: 'none' },
      }),
    })
  })

  it('hands unresolved write provenance to the authorized create use case', async () => {
    await executeTableInsertRows(
      'table-1',
      { workspaceId: 'workspace-forged', data: { Email: 'a@example.com' } },
      operationContext()
    )

    expect(mocks.createRows).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        assertedWorkspaceId: 'workspace-canonical',
        dataKeying: 'names',
        secretProvenanceEnvelope: { kind: 'none' },
      }),
    })
  })

  it('preserves legacy name-keyed filter, sort, count, and offset query semantics', async () => {
    await executeTableQueryRows(
      'table-1',
      {
        workspaceId: 'workspace-forged',
        filter: { Email: { $eq: 'a@example.com' } },
        sort: { Email: 'asc' },
        limit: 10,
        offset: 4,
        includeTotal: true,
      },
      operationContext()
    )

    expect(mocks.queryRows).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        assertedWorkspaceId: 'workspace-canonical',
        legacyFilter: { Email: { $eq: 'a@example.com' } },
        legacySort: { Email: 'asc' },
        legacyKeying: 'names',
        limit: 10,
        offset: 4,
        includeTotal: true,
        includeRunState: true,
        allowExpandedLimit: true,
      }),
    })
  })
})

/**
 * The seam between "the schema accepted the field" and "the use case received
 * it". A tool option that parses and is then dropped on the floor looks
 * identical to one that works, from both ends — so these assert forwarding, not
 * merely that the use case ran.
 */
describe('Table folder operations forward their options to the use case', () => {
  const FOLDER_ROW = {
    id: 'folder-1',
    name: 'Q3',
    parentId: null,
    createdAt: new Date('2026-08-27T00:00:00.000Z'),
    updatedAt: new Date('2026-08-27T00:00:00.000Z'),
  }
  const FOLDER_INDEX = {
    rowById: new Map([['folder-1', FOLDER_ROW]]),
    pathById: new Map([['folder-1', '/Reports/Q3']]),
    idByPath: new Map([['/Reports/Q3', 'folder-1']]),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listFolders.mockResolvedValue({
      folders: [FOLDER_ROW],
      index: FOLDER_INDEX,
      depthById: new Map([['folder-1', 2]]),
    })
    mocks.deleteFolder.mockResolvedValue({
      path: '/Reports',
      deleted: true,
      deletedItems: { folders: 1, tables: 0 },
      folder: { id: 'folder-1', name: 'Reports' },
    })
    mocks.updateTable.mockResolvedValue({
      table: { ...TABLE, folderId: 'folder-1' },
      folderPath: '/Reports',
      applied: ['folderPath'],
      changed: ['folderPath'],
    })
  })

  it('carries recursive and depth through to the listing', async () => {
    await executeTableListFolders(
      { path: '/Reports', recursive: true, depth: 3 },
      operationContext()
    )

    expect(mocks.listFolders).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        workspaceId: 'workspace-canonical',
        parentPath: '/Reports',
        recursive: true,
        maxDepth: 3,
      }),
    })
  })

  it('treats a depth as a request to walk deeper, without a separate recursive flag', async () => {
    /*
     * `depth: 3` alone is unambiguous about intent. Reading it as "direct
     * children only" would answer a narrower question and report success.
     */
    await executeTableListFolders({ path: '/Reports', depth: 3 }, operationContext())

    expect(mocks.listFolders).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({ recursive: true, maxDepth: 3 }),
    })
  })

  it('stays on direct children when neither recursive nor depth is given', async () => {
    await executeTableListFolders({ path: '/Reports' }, operationContext())

    expect(mocks.listFolders).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({ recursive: false, maxDepth: undefined }),
    })
  })

  it('lists from the workspace root when no path is given', async () => {
    const result = await executeTableListFolders({}, operationContext())

    expect(mocks.listFolders).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({ parentPath: '/' }),
    })
    expect(result.body).toMatchObject({ data: { path: '/' } })
  })

  it('reports each folder at its real depth below the listed folder', async () => {
    const result = await executeTableListFolders({ path: '/', recursive: true }, operationContext())

    expect(result.body).toMatchObject({
      data: { folders: [expect.objectContaining({ path: '/Reports/Q3', depth: 2 })] },
    })
  })

  it('marks a listing the limit cut short as truncated', async () => {
    const result = await executeTableListFolders({ path: '/', limit: 1 }, operationContext())
    expect(result.body).toMatchObject({ data: { truncated: false } })

    mocks.listFolders.mockResolvedValue({
      folders: [FOLDER_ROW, { ...FOLDER_ROW, id: 'folder-2' }],
      index: {
        ...FOLDER_INDEX,
        rowById: new Map([
          ['folder-1', FOLDER_ROW],
          ['folder-2', { ...FOLDER_ROW, id: 'folder-2' }],
        ]),
        pathById: new Map([
          ['folder-1', '/Reports/Q3'],
          ['folder-2', '/Reports/Q4'],
        ]),
      },
      depthById: new Map([
        ['folder-1', 1],
        ['folder-2', 1],
      ]),
    })
    const cut = await executeTableListFolders({ path: '/', limit: 1 }, operationContext())

    expect(cut.body).toMatchObject({ data: { truncated: true } })
  })

  it('forwards the delete cascade, and sends an absent one as off', async () => {
    await executeTableDeleteFolder({ path: '/Reports', recursive: true }, operationContext())
    expect(mocks.deleteFolder).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({ path: '/Reports', recursive: true }),
    })

    /*
     * The guard's whole point is that absent means "refuse a non-empty folder",
     * so it must reach the use case as `false` rather than as unspecified.
     */
    await executeTableDeleteFolder({ path: '/Reports' }, operationContext())
    expect(mocks.deleteFolder).toHaveBeenLastCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({ recursive: false }),
    })
  })

  it('moves a table by folder path, and reads an absent destination as the root', async () => {
    await executeTableMove({ tableId: 'table-1', folderPath: '/Reports' }, operationContext())
    expect(mocks.updateTable).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({ tableId: 'table-1', folderPath: '/Reports' }),
    })

    /*
     * An omitted folderPath means "leave the folder alone" to the update use
     * case, so dropping it would turn "move to the root" into a silent no-op.
     */
    await executeTableMove({ tableId: 'table-1' }, operationContext())
    expect(mocks.updateTable).toHaveBeenLastCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({ folderPath: '/' }),
    })
  })

  it('uses the canonical principal workspace, not one the caller could assert', async () => {
    await executeTableMove({ tableId: 'table-1', folderPath: '/Reports' }, operationContext())

    expect(mocks.updateTable).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({ workspaceId: 'workspace-canonical' }),
    })
  })

  it('rethrows a collected move failure rather than reporting a move that did not happen', async () => {
    mocks.updateTable.mockResolvedValue({
      table: TABLE,
      folderPath: null,
      applied: [],
      changed: [],
      failure: new Error('folder is locked'),
    })

    await expect(
      executeTableMove({ tableId: 'table-1', folderPath: '/Reports' }, operationContext())
    ).rejects.toThrow('folder is locked')
  })
})

/*
 * The three projections the forwarding suite above does not reach. Each one maps
 * a use-case result onto the tool's response shape, and a swapped field there
 * (`previousPath` for `requestedPath`, say) type-checks and ships silently.
 */
describe('Table folder operations project their use-case results', () => {
  const FOLDER_ROW = {
    id: 'folder-1',
    name: 'Q3',
    parentId: null,
    createdAt: new Date('2026-08-27T00:00:00.000Z'),
    updatedAt: new Date('2026-08-27T00:00:00.000Z'),
  }
  const FOLDER_INDEX = {
    rowById: new Map([['folder-1', FOLDER_ROW]]),
    pathById: new Map([['folder-1', '/Reports/Q3']]),
    idByPath: new Map([['/Reports/Q3', 'folder-1']]),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createFolder.mockResolvedValue({ folder: FOLDER_ROW, index: FOLDER_INDEX })
    mocks.updateFolder.mockResolvedValue({
      folder: FOLDER_ROW,
      index: FOLDER_INDEX,
      sourcePath: '/Archive/Q3',
    })
    mocks.restoreFolder.mockResolvedValue({
      folder: FOLDER_ROW,
      index: FOLDER_INDEX,
      requestedPath: '/Archive/Q3',
      restoredItems: { folders: 1, tables: 2 },
    })
  })

  it('creates a folder at the requested path and returns its canonical view', async () => {
    const result = await executeTableCreateFolder({ path: '/Reports/Q3' }, operationContext())

    expect(mocks.createFolder).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: 'workspace-canonical', path: '/Reports/Q3' },
    })
    expect(result.body).toMatchObject({
      data: { folder: { name: 'Q3', path: '/Reports/Q3', parentPath: '/Reports' } },
    })
  })

  it('reports where a moved folder came from, not where it went', async () => {
    const result = await executeTableUpdateFolder(
      { path: '/Archive/Q3', destinationPath: '/Reports/Q3' },
      operationContext()
    )

    expect(mocks.updateFolder).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({ path: '/Archive/Q3', destinationPath: '/Reports/Q3' }),
    })
    expect(result.body).toMatchObject({
      data: { folder: { path: '/Reports/Q3' }, previousPath: '/Archive/Q3' },
    })
  })

  it('reports a restored folder at where it LANDED alongside the path asked for', async () => {
    /*
     * Restore may re-root or rename, so the two paths legitimately differ and
     * the caller needs both to explain the outcome.
     */
    const result = await executeTableRestoreFolder({ path: '/Archive/Q3' }, operationContext())

    expect(result.body).toMatchObject({
      data: {
        folder: { path: '/Reports/Q3' },
        requestedPath: '/Archive/Q3',
        restoredItems: { folders: 1, tables: 2 },
      },
    })
  })

  it('refuses to name a folder the active tree no longer holds', async () => {
    /*
     * Reachable under a concurrent delete: the row came back from the query but
     * is gone from the index, so there is no path to present. Failing beats
     * inventing one.
     */
    mocks.createFolder.mockResolvedValue({
      folder: { ...FOLDER_ROW, id: 'folder-missing' },
      index: FOLDER_INDEX,
    })

    await expect(
      executeTableCreateFolder({ path: '/Reports/Q3' }, operationContext())
    ).rejects.toThrow(/missing from the active folder tree/i)
  })

  it('refuses to report a move the authoritative result does not confirm', async () => {
    mocks.updateTable.mockResolvedValue({
      table: undefined,
      folderPath: null,
      applied: ['folderPath'],
      changed: [],
    })

    await expect(
      executeTableMove({ tableId: 'table-1', folderPath: '/Reports' }, operationContext())
    ).rejects.toThrow(/missing from the authoritative result/i)
  })
})
