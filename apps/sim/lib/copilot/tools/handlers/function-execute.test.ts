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
  mockGeneratePresignedDownloadUrl,
  mockHasCloudStorage,
  mockExecuteTool,
} = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
  mockGetTableById: vi.fn(),
  mockListTables: vi.fn(),
  mockQueryRows: vi.fn(),
  mockGetOrCreateTableSnapshot: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockGeneratePresignedDownloadUrl: vi.fn(),
  mockHasCloudStorage: vi.fn(),
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
  SNAPSHOT_MAX_BYTES: 500 * 1024 * 1024,
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: mockDownloadFile,
  generatePresignedDownloadUrl: mockGeneratePresignedDownloadUrl,
  hasCloudStorage: mockHasCloudStorage,
}))
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
    _sandboxFiles?: Array<{ path: string; type?: string; content?: string; url?: string }>
  }
  return params._sandboxFiles ?? []
}

const snapshotCacheOn = (flag: string) => Promise.resolve(flag === 'table-snapshot-cache')

describe('executeFunctionExecute table mounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteTool.mockResolvedValue({ success: true })
    mockGetTableById.mockResolvedValue(table)
    mockIsFeatureEnabled.mockResolvedValue(false)
    // Row data is keyed by stable column id at rest, not display name.
    mockQueryRows.mockResolvedValue({ rows: [{ data: { col_name: 'Ada' } }] })
    mockHasCloudStorage.mockReturnValue(true)
    mockGeneratePresignedDownloadUrl.mockResolvedValue('https://s3.example/presigned?sig=abc')
  })

  it('flag OFF: drains the table inline via queryRows (existing path)', async () => {
    await executeFunctionExecute({ inputTables: ['tbl_1'] }, context as never)

    expect(mockQueryRows).toHaveBeenCalledTimes(1)
    expect(mockGetOrCreateTableSnapshot).not.toHaveBeenCalled()
    const files = mountedFiles()
    expect(files[0].path).toBe('/home/user/tables/tbl_1.csv')
    expect(files[0].content).toBe('name\nAda')
  })

  it('mounts CSV with display-name headers and id-keyed values, never column ids', async () => {
    mockGetTableById.mockResolvedValue({
      id: 'tbl_2',
      workspaceId: 'ws_1',
      rowCount: 2,
      schema: {
        columns: [
          { id: 'col_name', name: 'name', type: 'string' },
          { id: 'col_company', name: 'company', type: 'string' },
        ],
      },
    })
    mockQueryRows.mockResolvedValue({
      rows: [
        { data: { col_name: 'Ada', col_company: 'Analytical Engine' } },
        { data: { col_name: 'Grace', col_company: 'Navy, Inc' } },
      ],
    })

    await executeFunctionExecute({ inputTables: ['tbl_2'] }, context as never)

    const csv = mountedFiles()[0].content as string
    const lines = csv.split('\n')
    expect(lines[0]).toBe('name,company')
    expect(lines[1]).toBe('Ada,Analytical Engine')
    // Value containing a comma is quoted.
    expect(lines[2]).toBe('Grace,"Navy, Inc"')
    // No stable column id leaks into the mounted file.
    expect(csv).not.toContain('col_name')
    expect(csv).not.toContain('col_company')
  })

  it('reads values by column id for legacy name-keyed rows too', async () => {
    // Legacy column with no id: getColumnId falls back to name, so name-keyed data is correct.
    mockGetTableById.mockResolvedValue({
      id: 'tbl_legacy',
      workspaceId: 'ws_1',
      rowCount: 1,
      schema: { columns: [{ name: 'email', type: 'string' }] },
    })
    mockQueryRows.mockResolvedValue({ rows: [{ data: { email: 'a@b.com' } }] })

    await executeFunctionExecute({ inputTables: ['tbl_legacy'] }, context as never)

    expect(mountedFiles()[0].content).toBe('email\na@b.com')
  })

  it('flag ON + cloud storage: mounts by presigned URL, no bytes through web', async () => {
    mockIsFeatureEnabled.mockImplementation(snapshotCacheOn)
    mockGetOrCreateTableSnapshot.mockResolvedValue({
      key: 'table-snapshots/ws_1/tbl_1/v5.csv',
      size: 9,
      version: 5,
    })

    await executeFunctionExecute({ inputTables: ['tbl_1'] }, context as never)

    expect(mockGetOrCreateTableSnapshot).toHaveBeenCalledTimes(1)
    expect(mockQueryRows).not.toHaveBeenCalled()
    expect(mockDownloadFile).not.toHaveBeenCalled()
    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(
      'table-snapshots/ws_1/tbl_1/v5.csv',
      'execution',
      expect.any(Number)
    )
    expect(mountedFiles()[0]).toEqual({
      type: 'url',
      path: '/home/user/tables/tbl_1.csv',
      url: 'https://s3.example/presigned?sig=abc',
    })
  })

  it('flag ON + local storage: falls back to a buffered content mount', async () => {
    mockIsFeatureEnabled.mockImplementation(snapshotCacheOn)
    mockHasCloudStorage.mockReturnValue(false)
    mockGetOrCreateTableSnapshot.mockResolvedValue({
      key: 'table-snapshots/ws_1/tbl_1/v5.csv',
      size: 9,
      version: 5,
    })
    mockDownloadFile.mockResolvedValue(Buffer.from('name\nAda\n'))

    await executeFunctionExecute({ inputTables: ['tbl_1'] }, context as never)

    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'table-snapshots/ws_1/tbl_1/v5.csv', context: 'execution' })
    )
    const file = mountedFiles()[0]
    expect(file.path).toBe('/home/user/tables/tbl_1.csv')
    expect(file.content).toBe('name\nAda\n')
    expect(file.type).toBeUndefined()
  })

  it('flag ON but small table stays on the inline path', async () => {
    mockIsFeatureEnabled.mockImplementation(snapshotCacheOn)
    mockGetTableById.mockResolvedValue({ ...table, rowCount: 10 })

    await executeFunctionExecute({ inputTables: ['tbl_1'] }, context as never)

    expect(mockGetOrCreateTableSnapshot).not.toHaveBeenCalled()
    expect(mockQueryRows).toHaveBeenCalledTimes(1)
  })

  it('flag ON + cloud: throws when the snapshot exceeds the table mount limit', async () => {
    mockIsFeatureEnabled.mockImplementation(snapshotCacheOn)
    mockGetOrCreateTableSnapshot.mockResolvedValue({
      key: 'table-snapshots/ws_1/tbl_1/v5.csv',
      size: 600 * 1024 * 1024,
      version: 5,
    })

    await expect(
      executeFunctionExecute({ inputTables: ['tbl_1'] }, context as never)
    ).rejects.toThrow(/table mount limit/)
    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
  })

  it('flag ON + local: throws when the snapshot exceeds the per-file mount limit', async () => {
    mockIsFeatureEnabled.mockImplementation(snapshotCacheOn)
    mockHasCloudStorage.mockReturnValue(false)
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
