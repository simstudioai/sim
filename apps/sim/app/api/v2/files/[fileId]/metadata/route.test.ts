/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockResolveWorkspaceAccess, mockGetWorkspaceFile } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  getWorkspaceFile: mockGetWorkspaceFile,
}))

import { GET } from '@/app/api/v2/files/[fileId]/metadata/route'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

const ctx = { params: Promise.resolve({ fileId: FILE_ID }) }

function buildRecord() {
  return {
    id: FILE_ID,
    workspaceId: WORKSPACE_ID,
    name: 'data.csv',
    key: 'workspace/ws/1-x-data.csv',
    path: '/api/files/serve/x',
    size: 1024,
    type: 'text/csv',
    uploadedBy: 'user-1',
    folderId: null,
    folderPath: null,
    uploadedAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
  }
}

const callGet = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/metadata?${query}`), ctx)

describe('GET /api/v2/files/[fileId]/metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetWorkspaceFile.mockResolvedValue(buildRecord())
  })

  it('400s when workspaceId is missing', async () => {
    const response = await callGet('')

    expect(response.status).toBe(400)
    expect(mockGetWorkspaceFile).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })

    const response = await callGet(`workspaceId=${WORKSPACE_ID}`)

    expect(response.status).toBe(403)
    expect(mockGetWorkspaceFile).not.toHaveBeenCalled()
  })

  it('404s when the workspace-scoped file does not exist', async () => {
    mockGetWorkspaceFile.mockResolvedValue(null)

    const response = await callGet(`workspaceId=${WORKSPACE_ID}`)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })

  it('returns the public metadata projection without loading content', async () => {
    const response = await callGet(`workspaceId=${WORKSPACE_ID}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: FILE_ID,
        name: 'data.csv',
        size: 1024,
        type: 'text/csv',
        key: 'workspace/ws/1-x-data.csv',
        folderId: null,
        folderPath: null,
        uploadedBy: 'user-1',
        uploadedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    })
    expect(mockResolveWorkspaceAccess).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      WORKSPACE_ID,
      'read'
    )
    expect(mockGetWorkspaceFile).toHaveBeenCalledWith(WORKSPACE_ID, FILE_ID, {
      throwOnError: true,
    })
  })
})
