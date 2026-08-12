/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateTable,
  mockCreateUploadSession,
  mockDbLimit,
  mockGetUserSettings,
  mockGetWorkspaceFile,
  mockGetWorkspaceTableLimits,
  mockRunDetached,
} = vi.hoisted(() => ({
  mockCreateTable: vi.fn(),
  mockCreateUploadSession: vi.fn(),
  mockDbLimit: vi.fn(),
  mockGetUserSettings: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockGetWorkspaceTableLimits: vi.fn(),
  mockRunDetached: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: mockDbLimit }),
      }),
    }),
  },
}))
vi.mock('@/lib/core/config/env-flags', () => ({ isTriggerDevEnabled: false }))
vi.mock('@/lib/core/utils/background', () => ({ runDetached: mockRunDetached }))
vi.mock('@/lib/table/billing', () => ({ getWorkspaceTableLimits: mockGetWorkspaceTableLimits }))
vi.mock('@/lib/table/import-runner', () => ({ runTableImport: vi.fn() }))
vi.mock('@/lib/table/service', () => ({
  createTable: mockCreateTable,
  getTableById: vi.fn(),
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({ getWorkspaceFile: mockGetWorkspaceFile }))
vi.mock('@/lib/uploads/upload-session/service', () => ({
  abortUploadSession: vi.fn(),
  createUploadSession: mockCreateUploadSession,
  getOwnedUploadSession: vi.fn(),
}))
vi.mock('@/lib/users/queries', () => ({ getUserSettings: mockGetUserSettings }))

import { CSV_DURABLE_MAX_FILE_SIZE_BYTES } from '@/lib/table/import'
import { createAuthorizedTableImportResource } from '@/lib/table/orchestration/import-resource'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const SOURCE = { type: 'workspace_file' as const, fileId: 'file-1' }
const TARGET = { type: 'new' as const, name: 'imported_data' }
const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }

function createImport(body: Parameters<typeof createAuthorizedTableImportResource>[0]['body']) {
  return createAuthorizedTableImportResource({
    body,
    userId: 'user-1',
    principal,
    localOrigin: 'http://localhost:3000',
  })
}

function workspaceFile(size: number) {
  return {
    id: 'file-1',
    workspaceId: WORKSPACE_ID,
    name: 'data.csv',
    key: 'workspace/data.csv',
    path: '/api/files/serve/workspace/data.csv',
    size,
    type: 'text/csv',
    uploadedBy: 'user-1',
    uploadedAt: new Date('2026-08-04T12:00:00.000Z'),
    updatedAt: new Date('2026-08-04T12:00:00.000Z'),
  }
}

describe('createAuthorizedTableImportResource workspace file size', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkspaceTableLimits.mockResolvedValue({ maxTables: 100, maxRowsPerTable: 10_000 })
    mockCreateTable.mockResolvedValue({ id: 'table-1' })
    mockGetUserSettings.mockResolvedValue({ timezone: 'UTC' })
    mockDbLimit.mockResolvedValue([
      {
        id: 'import-1',
        workspaceId: WORKSPACE_ID,
        tableId: 'table-1',
        type: 'import',
        status: 'running',
        rowsProcessed: 0,
        error: null,
        payload: {
          kind: 'table_import',
          userId: 'user-1',
          source: SOURCE,
          target: TARGET,
          options: {},
        },
        startedAt: new Date('2026-08-04T12:00:00.000Z'),
        updatedAt: new Date('2026-08-04T12:00:00.000Z'),
        completedAt: null,
      },
    ])
  })

  it('accepts a workspace CSV at the exact byte limit', async () => {
    mockGetWorkspaceFile.mockResolvedValue(workspaceFile(CSV_DURABLE_MAX_FILE_SIZE_BYTES))

    const result = await createImport({ workspaceId: WORKSPACE_ID, source: SOURCE, target: TARGET })

    expect(result.upload).toBeNull()
    expect(mockCreateTable).toHaveBeenCalledOnce()
    expect(mockRunDetached).toHaveBeenCalledOnce()
  })

  it('rejects a workspace CSV one byte over the limit before creating a table', async () => {
    mockGetWorkspaceFile.mockResolvedValue(workspaceFile(CSV_DURABLE_MAX_FILE_SIZE_BYTES + 1))

    await expect(
      createImport({ workspaceId: WORKSPACE_ID, source: SOURCE, target: TARGET })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mockCreateTable).not.toHaveBeenCalled()
    expect(mockRunDetached).not.toHaveBeenCalled()
  })
})

describe('createAuthorizedTableImportResource upload size', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateUploadSession.mockResolvedValue({
      id: 'import-1',
      userId: 'user-1',
      status: 'uploading',
      uploadToken: 'signed-token',
      transfer: { method: 'put', url: 'https://storage.example/upload', headers: {} },
      createdAt: new Date('2026-08-04T12:00:00.000Z'),
      updatedAt: new Date('2026-08-04T12:00:00.000Z'),
      completedAt: null,
    })
  })

  it('creates an upload session for a CSV at the exact byte limit', async () => {
    await createImport({
      workspaceId: WORKSPACE_ID,
      source: {
        type: 'upload',
        name: 'data.csv',
        contentType: 'text/csv',
        size: CSV_DURABLE_MAX_FILE_SIZE_BYTES,
      },
      target: TARGET,
    })

    expect(mockCreateUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        fileSize: CSV_DURABLE_MAX_FILE_SIZE_BYTES,
        purpose: 'table_import',
      })
    )
  })

  it('rejects an upload one byte over the limit before creating a session', async () => {
    await expect(
      createImport({
        workspaceId: WORKSPACE_ID,
        source: {
          type: 'upload',
          name: 'data.csv',
          contentType: 'text/csv',
          size: CSV_DURABLE_MAX_FILE_SIZE_BYTES + 1,
        },
        target: TARGET,
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mockCreateUploadSession).not.toHaveBeenCalled()
  })
})
