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
  mockListWorkspaceFiles,
  mockFindWorkspaceFileRecord,
  mockFetchWorkspaceFileBuffer,
  mockGetSandboxWorkspaceFilePath,
  mockListWorkspaceFileFolders,
  mockResolveChatUpload,
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
  mockListWorkspaceFiles: vi.fn(),
  mockFindWorkspaceFileRecord: vi.fn(),
  mockFetchWorkspaceFileBuffer: vi.fn(),
  mockGetSandboxWorkspaceFilePath: vi.fn(),
  mockListWorkspaceFileFolders: vi.fn(),
  mockResolveChatUpload: vi.fn(),
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
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: mockFetchWorkspaceFileBuffer,
  findWorkspaceFileRecord: mockFindWorkspaceFileRecord,
  getSandboxWorkspaceFilePath: mockGetSandboxWorkspaceFilePath,
  listWorkspaceFiles: mockListWorkspaceFiles,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  listWorkspaceFileFolders: mockListWorkspaceFileFolders,
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
vi.mock('@/lib/copilot/tools/handlers/upload-file-reader', () => ({
  resolveChatUpload: mockResolveChatUpload,
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

const fileRecord = {
  id: 'file_1',
  workspaceId: 'ws_1',
  name: 'data.csv',
  key: 'workspace/ws_1/data.csv',
  path: '/api/files/serve/workspace%2Fws_1%2Fdata.csv',
  size: 100,
  type: 'text/csv',
  storageContext: 'workspace' as const,
}

const uploadRecord = {
  ...fileRecord,
  id: 'upload_1',
  name: 'My Report.csv',
  key: 'mothership/chat_1/my-report.csv',
  storageContext: 'mothership' as const,
}

describe('executeFunctionExecute file mounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteTool.mockResolvedValue({ success: true })
    mockIsFeatureEnabled.mockResolvedValue(false)
    mockHasCloudStorage.mockReturnValue(true)
    mockGeneratePresignedDownloadUrl.mockResolvedValue('https://s3.example/file?sig=abc')
    mockListWorkspaceFiles.mockResolvedValue([fileRecord])
    mockFindWorkspaceFileRecord.mockReturnValue(fileRecord)
    mockGetSandboxWorkspaceFilePath.mockReturnValue('/home/user/files/data.csv')
  })

  it('cloud storage: mounts by presigned URL with the record context, no bytes through web', async () => {
    await executeFunctionExecute({ inputFiles: ['files/data.csv'] }, context as never)

    expect(mockFetchWorkspaceFileBuffer).not.toHaveBeenCalled()
    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(
      'workspace/ws_1/data.csv',
      'workspace',
      expect.any(Number)
    )
    expect(mountedFiles()[0]).toEqual({
      type: 'url',
      path: '/home/user/files/data.csv',
      url: 'https://s3.example/file?sig=abc',
    })
  })

  it('local storage: falls back to a buffered inline content mount', async () => {
    mockHasCloudStorage.mockReturnValue(false)
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('name\nAda\n'))

    await executeFunctionExecute({ inputFiles: ['files/data.csv'] }, context as never)

    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
    const file = mountedFiles()[0]
    expect(file.path).toBe('/home/user/files/data.csv')
    expect(file.content).toBe('name\nAda\n')
    expect(file.type).toBeUndefined()
  })

  it('mounts a chat upload at its canonical sandbox path', async () => {
    mockResolveChatUpload.mockResolvedValue(uploadRecord)

    await executeFunctionExecute({ inputs: { files: [{ path: 'uploads/My%20Report.csv' }] } }, {
      ...context,
      chatId: 'chat_1',
    } as never)

    expect(mockResolveChatUpload).toHaveBeenCalledWith('My%20Report.csv', 'chat_1')
    expect(mockListWorkspaceFiles).not.toHaveBeenCalled()
    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(
      'mothership/chat_1/my-report.csv',
      'mothership',
      expect.any(Number)
    )
    expect(mountedFiles()[0]).toEqual({
      type: 'url',
      path: '/home/user/uploads/My%20Report.csv',
      url: 'https://s3.example/file?sig=abc',
    })
  })

  it('reports when a chat upload is no longer available', async () => {
    mockResolveChatUpload.mockResolvedValue(null)

    await expect(
      executeFunctionExecute({ inputFiles: ['uploads/missing.csv'] }, {
        ...context,
        chatId: 'chat_1',
      } as never)
    ).rejects.toThrow('Upload not found: "uploads/missing.csv"')
  })

  it('rejects a chat upload from another workspace', async () => {
    mockResolveChatUpload.mockResolvedValue({ ...uploadRecord, workspaceId: 'ws_2' })

    await expect(
      executeFunctionExecute({ inputFiles: ['uploads/My%20Report.csv'] }, {
        ...context,
        chatId: 'chat_1',
      } as never)
    ).rejects.toThrow('Upload does not belong to the current workspace')
    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
  })

  it('cloud storage: throws when a file exceeds the per-file URL mount limit', async () => {
    mockFindWorkspaceFileRecord.mockReturnValue({ ...fileRecord, size: 600 * 1024 * 1024 })

    await expect(
      executeFunctionExecute({ inputFiles: ['files/data.csv'] }, context as never)
    ).rejects.toThrow(/per-file mount limit/)
    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
  })

  it('cloud storage: throws when mounts exceed the aggregate URL mount limit', async () => {
    // Each file is at the 500MB per-file cap; the 5th pushes the running total past 2GB.
    mockFindWorkspaceFileRecord.mockReturnValue({ ...fileRecord, size: 500 * 1024 * 1024 })
    const paths = Array.from({ length: 5 }, (_, i) => `files/big-${i}.csv`)

    await expect(executeFunctionExecute({ inputFiles: paths }, context as never)).rejects.toThrow(
      /total mount limit/
    )
    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledTimes(4)
  })

  it('throws when the inputFiles list exceeds the mounted-file count cap', async () => {
    const paths = Array.from({ length: 501 }, (_, i) => `files/f-${i}.csv`)

    await expect(executeFunctionExecute({ inputFiles: paths }, context as never)).rejects.toThrow(
      /Too many input files/
    )
    expect(mockListWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('cloud storage: mounts each directory descendant by presigned URL', async () => {
    mockListWorkspaceFileFolders.mockResolvedValue([{ path: 'Reports' }])
    const descendant = {
      ...fileRecord,
      name: 'q1.csv',
      key: 'workspace/ws_1/q1.csv',
      folderPath: 'Reports',
    }
    mockListWorkspaceFiles.mockResolvedValue([descendant])

    await executeFunctionExecute({ inputs: { directories: ['files/Reports'] } }, context as never)

    expect(mockFetchWorkspaceFileBuffer).not.toHaveBeenCalled()
    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(
      'workspace/ws_1/q1.csv',
      'workspace',
      expect.any(Number)
    )
    expect(mountedFiles()[0]).toEqual({
      type: 'url',
      path: '/home/user/files/Reports/q1.csv',
      url: 'https://s3.example/file?sig=abc',
    })
  })

  it('local storage: buffers directory descendants via inline content', async () => {
    mockHasCloudStorage.mockReturnValue(false)
    mockListWorkspaceFileFolders.mockResolvedValue([{ path: 'Reports' }])
    const descendant = {
      ...fileRecord,
      name: 'q1.csv',
      key: 'workspace/ws_1/q1.csv',
      folderPath: 'Reports',
    }
    mockListWorkspaceFiles.mockResolvedValue([descendant])
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('a,b\n1,2\n'))

    await executeFunctionExecute({ inputs: { directories: ['files/Reports'] } }, context as never)

    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
    const file = mountedFiles()[0]
    expect(file.path).toBe('/home/user/files/Reports/q1.csv')
    expect(file.content).toBe('a,b\n1,2\n')
    expect(file.type).toBeUndefined()
  })
})
