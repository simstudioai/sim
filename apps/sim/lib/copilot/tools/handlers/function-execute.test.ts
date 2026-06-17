/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockIsFeatureEnabled,
  mockGetTableById,
  mockListTables,
  mockQueryRows,
  mockGetOrCreateTableSnapshot,
  mockDownloadFile,
  mockExecuteTool,
} = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
  mockGetTableById: vi.fn(),
  mockListTables: vi.fn(),
  mockQueryRows: vi.fn(),
  mockGetOrCreateTableSnapshot: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockExecuteTool: vi.fn(),
}))

vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: mockIsFeatureEnabled }))
vi.mock('@/lib/table/service', () => ({
  getTableById: mockGetTableById,
  listTables: mockListTables,
}))
vi.mock('@/lib/table/rows/service', () => ({ queryRows: mockQueryRows }))
vi.mock('@/lib/table/snapshot-cache', () => ({
  getOrCreateTableSnapshot: mockGetOrCreateTableSnapshot,
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({ downloadFile: mockDownloadFile }))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))
// Workspace-file + VFS surfaces are unused on the tables-only path; stub to avoid heavy loads.
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: vi.fn(),
  findWorkspaceFileRecord: vi.fn(),
  getSandboxWorkspaceFilePath: vi.fn(),
  listWorkspaceFiles: vi.fn(),
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  listWorkspaceFileFolders: vi.fn(),
}))
vi.mock('@/lib/copilot/vfs/path-utils', () => ({
  decodeVfsPathSegments: (p: string) => p.split('/'),
  encodeVfsPathSegments: (s: string[]) => s.join('/'),
}))
vi.mock('@/lib/copilot/vfs/workflow-alias-resolver', () => ({
  resolveWorkflowAliasForWorkspace: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/copilot/vfs/workflow-aliases', () => ({
  isPlanAliasPath: () => false,
  workflowAliasSandboxPath: (p: string) => p,
}))

import { executeFunctionExecute } from '@/lib/copilot/tools/handlers/function-execute'

const table = {
  id: 'tbl_1',
  workspaceId: 'ws_1',
  rowCount: 1000,
  schema: { columns: [{ id: 'col_name', name: 'name', type: 'string' }] },
}

const context = { workspaceId: 'ws_1', userId: 'u1' }

function mountedFiles() {
  const params = mockExecuteTool.mock.calls[0][1] as {
    _sandboxFiles?: Array<{ path: string; content: string }>
  }
  return params._sandboxFiles ?? []
}

describe('executeFunctionExecute table mounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteTool.mockResolvedValue({ success: true })
    mockGetTableById.mockResolvedValue(table)
    mockIsFeatureEnabled.mockResolvedValue(false)
    mockQueryRows.mockResolvedValue({ rows: [{ data: { name: 'Ada' } }] })
  })

  it('flag OFF: drains the table inline via queryRows (existing path)', async () => {
    await executeFunctionExecute({ inputTables: ['tbl_1'] }, context as never)

    expect(mockQueryRows).toHaveBeenCalledTimes(1)
    expect(mockGetOrCreateTableSnapshot).not.toHaveBeenCalled()
    const files = mountedFiles()
    expect(files[0].path).toBe('/home/user/tables/tbl_1.csv')
    expect(files[0].content).toBe('name\nAda')
  })

  it('flag ON + large table: mounts by reference from the snapshot, no row drain', async () => {
    mockIsFeatureEnabled.mockImplementation((flag: string) =>
      Promise.resolve(flag === 'table-snapshot-cache')
    )
    mockGetOrCreateTableSnapshot.mockResolvedValue({
      key: 'table-snapshots/ws_1/tbl_1/v5.csv',
      size: 9,
      version: 5,
    })
    mockDownloadFile.mockResolvedValue(Buffer.from('name\nAda\n'))

    await executeFunctionExecute({ inputTables: ['tbl_1'] }, context as never)

    expect(mockGetOrCreateTableSnapshot).toHaveBeenCalledTimes(1)
    expect(mockQueryRows).not.toHaveBeenCalled()
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'table-snapshots/ws_1/tbl_1/v5.csv', context: 'execution' })
    )
    const files = mountedFiles()
    expect(files[0].path).toBe('/home/user/tables/tbl_1.csv')
    expect(files[0].content).toBe('name\nAda\n')
  })

  it('flag ON but small table stays on the inline path', async () => {
    mockIsFeatureEnabled.mockImplementation((flag: string) =>
      Promise.resolve(flag === 'table-snapshot-cache')
    )
    mockGetTableById.mockResolvedValue({ ...table, rowCount: 10 })

    await executeFunctionExecute({ inputTables: ['tbl_1'] }, context as never)

    expect(mockGetOrCreateTableSnapshot).not.toHaveBeenCalled()
    expect(mockQueryRows).toHaveBeenCalledTimes(1)
  })

  it('flag ON: throws when the snapshot exceeds the per-file mount limit', async () => {
    mockIsFeatureEnabled.mockImplementation((flag: string) =>
      Promise.resolve(flag === 'table-snapshot-cache')
    )
    mockGetOrCreateTableSnapshot.mockResolvedValue({
      key: 'table-snapshots/ws_1/tbl_1/v5.csv',
      size: 20 * 1024 * 1024,
      version: 5,
    })

    await expect(
      executeFunctionExecute({ inputTables: ['tbl_1'] }, context as never)
    ).rejects.toThrow(/per-file mount limit/)
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  it('rejects a table that belongs to another workspace (tenant isolation)', async () => {
    mockGetTableById.mockResolvedValue({ ...table, workspaceId: 'ws_2' })

    await expect(
      executeFunctionExecute({ inputTables: ['tbl_1'] }, context as never)
    ).rejects.toThrow(/Input table not found/)
    expect(mockGetOrCreateTableSnapshot).not.toHaveBeenCalled()
  })
})
