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
  mockAssertWorkspaceTableCapacity,
  mockRunDetached,
} = vi.hoisted(() => ({
  mockCreateTable: vi.fn(),
  mockCreateUploadSession: vi.fn(),
  mockDbLimit: vi.fn(),
  mockGetUserSettings: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockGetWorkspaceTableLimits: vi.fn(),
  mockAssertWorkspaceTableCapacity: vi.fn(),
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
  assertWorkspaceTableCapacity: mockAssertWorkspaceTableCapacity,
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
import {
  createAuthorizedTableImportResource,
  findTableImportResource,
  getTableImportResource,
} from '@/lib/table/orchestration/import-resource'

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
    mockGetWorkspaceTableLimits.mockResolvedValue({ maxTables: 100, maxRowsPerTable: 10_000 })
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

/**
 * `type = 'import'` rows are written by the first-party CSV paths too, without
 * the v2 payload. Those ids are reachable from a v2 read — `GET /tables/{id}`
 * hands the caller the running job's id — so an unreadable job must answer 404,
 * not an unclassified error the v2 policy can only render as a 500.
 */
describe('findTableImportResource on a job that is not a v2 import resource', () => {
  const IMPORT_ID = 'job-1'

  function job(overrides: Record<string, unknown>) {
    return {
      id: IMPORT_ID,
      tableId: 'table-1',
      workspaceId: WORKSPACE_ID,
      type: 'import',
      status: 'running',
      payload: null,
      rowsProcessed: 0,
      error: null,
      startedAt: new Date('2026-08-04T12:00:00.000Z'),
      updatedAt: new Date('2026-08-04T12:00:00.000Z'),
      completedAt: null,
      ...overrides,
    }
  }

  const PAYLOAD = {
    kind: 'table_import',
    userId: 'user-1',
    source: SOURCE,
    target: TARGET,
    options: {},
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads a first-party import job with a null payload as absent', async () => {
    mockDbLimit.mockResolvedValue([job({})])

    await expect(findTableImportResource({ importId: IMPORT_ID })).resolves.toBeNull()
    await expect(getTableImportResource({ importId: IMPORT_ID })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('reads a job in a status the resource cannot represent as absent', async () => {
    mockDbLimit.mockResolvedValue([job({ payload: PAYLOAD, status: 'queued' })])

    await expect(findTableImportResource({ importId: IMPORT_ID })).resolves.toBeNull()
    await expect(getTableImportResource({ importId: IMPORT_ID })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('still reads a well-formed v2 import job', async () => {
    mockDbLimit.mockResolvedValue([job({ payload: PAYLOAD })])

    await expect(findTableImportResource({ importId: IMPORT_ID })).resolves.toMatchObject({
      id: IMPORT_ID,
      status: 'running',
      source: SOURCE,
      target: TARGET,
    })
  })
})

/**
 * The table ceiling was enforced only by `createTable`, which for an
 * upload-backed import does not run until the CSV has already been transferred.
 * A workspace at its limit got a 201 and a presigned PUT for up to 5 GiB, and
 * learned it was refused only at `complete` — by which point the bytes were paid
 * for and an orphaned object was sitting in storage.
 */
describe('createAuthorizedTableImportResource table quota', () => {
  const limitReached = Object.assign(new Error('Workspace has reached maximum table limit (5)'), {
    code: 'WORKSPACE_RESOURCE_LIMIT_REACHED',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkspaceTableLimits.mockResolvedValue({ maxTables: 5, maxRowsPerTable: 10_000 })
    mockGetUserSettings.mockResolvedValue({ timezone: 'UTC' })
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

  it('refuses an upload-backed import for a new table before handing out a transfer', async () => {
    mockAssertWorkspaceTableCapacity.mockRejectedValue(limitReached)

    await expect(
      createImport({
        workspaceId: WORKSPACE_ID,
        source: { type: 'upload', name: 'data.csv', contentType: 'text/csv', size: 1024 },
        target: TARGET,
      })
    ).rejects.toThrow(/maximum table limit/)

    expect(mockAssertWorkspaceTableCapacity).toHaveBeenCalledWith(WORKSPACE_ID, 5)
    expect(mockCreateUploadSession).not.toHaveBeenCalled()
  })

  it('creates the session when the workspace still has room', async () => {
    mockAssertWorkspaceTableCapacity.mockResolvedValue(undefined)

    await createImport({
      workspaceId: WORKSPACE_ID,
      source: { type: 'upload', name: 'data.csv', contentType: 'text/csv', size: 1024 },
      target: TARGET,
    })

    expect(mockCreateUploadSession).toHaveBeenCalledOnce()
  })

  it('does not check the table ceiling when importing into an existing table', async () => {
    mockAssertWorkspaceTableCapacity.mockResolvedValue(undefined)
    mockGetWorkspaceFile.mockResolvedValue(workspaceFile(1024))

    await createImport({
      workspaceId: WORKSPACE_ID,
      source: { type: 'upload', name: 'data.csv', contentType: 'text/csv', size: 1024 },
      target: { type: 'existing', tableId: 'table-1', mode: 'append' },
    }).catch(() => undefined)

    expect(mockAssertWorkspaceTableCapacity).not.toHaveBeenCalled()
  })
})
