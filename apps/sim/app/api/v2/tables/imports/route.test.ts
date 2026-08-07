/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockCreateTableImportResource,
  mockToV2CreateTableImport,
  mockLoadActiveFolderPathIndex,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockCreateTableImportResource: vi.fn(),
  mockToV2CreateTableImport: vi.fn(),
  mockLoadActiveFolderPathIndex: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceScope: mockResolveWorkspaceScope,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/app/api/v2/tables/utils', () => ({
  v2TableLockError: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/table/orchestration/import-resource', () => ({
  createTableImportResource: mockCreateTableImportResource,
  toV2CreateTableImport: mockToV2CreateTableImport,
}))

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mockLoadActiveFolderPathIndex,
}))

import { POST } from '@/app/api/v2/tables/imports/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const RATE_LIMIT = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-08-03T22:00:00.000Z'),
}

describe('POST /api/v2/tables/imports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT)
    mockResolveWorkspaceScope.mockResolvedValue(null)
    mockLoadActiveFolderPathIndex.mockResolvedValue({
      rowById: new Map(),
      pathById: new Map(),
      idByPath: new Map(),
    })
  })

  it.each([
    [
      'upload',
      { type: 'upload', name: 'data.csv', contentType: 'text/csv', size: 128 },
      {
        session: { id: 'import-1', source: { type: 'upload' } },
        uploadToken: 'signed-token',
        transfer: { method: 'put', url: 'https://storage.example/upload', headers: {} },
      },
    ],
    [
      'workspace file',
      { type: 'workspace_file', fileId: 'file-1' },
      {
        session: { id: 'import-1', source: { type: 'workspace_file', fileId: 'file-1' } },
        uploadToken: null,
        transfer: null,
      },
    ],
  ])('returns the create envelope for a %s source', async (_label, source, responseData) => {
    const requestBody = {
      workspaceId: WORKSPACE_ID,
      source,
      target: { type: 'new', name: 'imported_data' },
    }
    const created = { record: { id: 'import-1' }, upload: null }
    mockCreateTableImportResource.mockResolvedValue(created)
    mockToV2CreateTableImport.mockReturnValue(responseData)

    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/tables/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
    )

    expect(response.status).toBe(201)
    expect(mockCreateTableImportResource).toHaveBeenCalledWith(
      requestBody,
      'user-1',
      'http://localhost:3000',
      null,
      {
        actorUserId: 'user-1',
        ownerUserId: 'user-1',
        useOwnerTimezone: false,
      }
    )
    expect(mockToV2CreateTableImport).toHaveBeenCalledWith(created)
    expect(await response.json()).toEqual({ data: responseData })
  })

  it('accepts native JSON mapping and createColumns values', async () => {
    const requestBody = {
      workspaceId: WORKSPACE_ID,
      source: { type: 'upload', name: 'data.csv', contentType: 'text/csv', size: 128 },
      target: { type: 'existing', tableId: 'table-1', mode: 'append' },
      mapping: { email: 'email_address', notes: null },
      createColumns: ['phone'],
    }
    const created = { record: { id: 'import-1' }, upload: null }
    const responseData = {
      session: { id: 'import-1', source: { type: 'upload' } },
      uploadToken: 'signed-token',
      transfer: { method: 'put', url: 'https://storage.example/upload', headers: {} },
    }
    mockCreateTableImportResource.mockResolvedValue(created)
    mockToV2CreateTableImport.mockReturnValue(responseData)

    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/tables/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
    )

    expect(response.status).toBe(201)
    expect(mockCreateTableImportResource).toHaveBeenCalledWith(
      requestBody,
      'user-1',
      'http://localhost:3000',
      undefined,
      {
        actorUserId: 'user-1',
        ownerUserId: 'user-1',
        useOwnerTimezone: false,
      }
    )
  })

  it('keeps the key creator as upload owner while attributing the import to the payer', async () => {
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT,
      userId: 'payer-1',
      principalUserId: 'creator-1',
    })
    const requestBody = {
      workspaceId: WORKSPACE_ID,
      source: { type: 'upload', name: 'data.csv', contentType: 'text/csv', size: 128 },
      target: { type: 'existing', tableId: 'table-1', mode: 'append' },
    }
    mockCreateTableImportResource.mockResolvedValue({ record: { id: 'import-1' }, upload: null })
    mockToV2CreateTableImport.mockReturnValue({})

    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/tables/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
    )

    expect(response.status).toBe(201)
    expect(mockCreateTableImportResource).toHaveBeenCalledWith(
      requestBody,
      'payer-1',
      'http://localhost:3000',
      undefined,
      {
        actorUserId: 'payer-1',
        ownerUserId: 'creator-1',
        useOwnerTimezone: false,
      }
    )
  })
})
