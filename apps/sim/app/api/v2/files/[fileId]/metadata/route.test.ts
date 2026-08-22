/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readMetadata: vi.fn(),
  getUserEmailsByIds: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/read-workspace-file-metadata', () => ({
  readWorkspaceFileMetadata: {
    operation: { id: 'files.read_metadata', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.readMetadata,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mocks.getUserEmailsByIds,
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId)!,
}))

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/v2/files/[fileId]/metadata/route'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'
const context = { params: Promise.resolve({ fileId: FILE_ID }) }
const auth = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const SHARE = {
  id: 'share-1',
  token: 'share-token',
  url: 'https://example.com/f/share-token',
  isActive: true,
  resourceType: 'file',
  resourceId: FILE_ID,
  authType: 'public',
  hasPassword: false,
  allowedEmails: [],
}

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
  GET(new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/metadata?${query}`), context)

/**
 * Stands in for the application use case's lifecycle predicate: a soft-deleted row only
 * resolves when the caller opted into the archived set through `includeDeleted`.
 */
const archivedFileUseCase = async ({ input }: { input: { includeDeleted?: boolean } }) => {
  if (!input.includeDeleted) throw new OrchestrationError('not_found', 'File not found')
  return { file: { ...buildRecord(), deletedAt: new Date('2024-01-03T00:00:00Z') }, share: SHARE }
}

describe('GET /api/v2/files/[fileId]/metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.readMetadata.mockResolvedValue({ file: buildRecord(), share: SHARE })
    mocks.getUserEmailsByIds.mockResolvedValue(new Map([['user-1', 'ada@example.com']]))
  })

  it('authenticates and charges before rejecting a missing workspaceId', async () => {
    const response = await callGet('')

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalled()
    expect(v2RouteMocks.operationRate).toHaveBeenCalledTimes(2)
    expect(mocks.readMetadata).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await callGet(`workspaceId=${WORKSPACE_ID}`)

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })

  it('conceals cross-workspace authorization as not found', async () => {
    mocks.readMetadata.mockRejectedValue(new NoWorkspaceAccessError())

    const response = await callGet(`workspaceId=${WORKSPACE_ID}`)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })

  it('returns the v2 metadata projection through the shared use case', async () => {
    const response = await callGet(`workspaceId=${WORKSPACE_ID}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: FILE_ID,
        name: 'data.csv',
        size: 1024,
        type: 'text/csv',
        key: 'workspace/ws/1-x-data.csv',
        folderPath: '/',
        uploadedByEmail: 'ada@example.com',
        uploadedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        deletedAt: null,
        share: SHARE,
      },
    })
    expect(mocks.readMetadata).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID, includeDeleted: false },
      request: expect.anything(),
    })
  })

  it('leaves an archived file unreachable when scope is omitted', async () => {
    mocks.readMetadata.mockImplementation(archivedFileUseCase)

    const response = await callGet(`workspaceId=${WORKSPACE_ID}`)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
    expect(mocks.readMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID, includeDeleted: false },
      })
    )
  })

  it('leaves an archived file unreachable under an explicit scope=active', async () => {
    mocks.readMetadata.mockImplementation(archivedFileUseCase)

    const response = await callGet(`workspaceId=${WORKSPACE_ID}&scope=active`)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
    expect(mocks.readMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID, includeDeleted: false },
      })
    )
  })

  it('returns archived metadata when scope=archived opts into the archived set', async () => {
    mocks.readMetadata.mockImplementation(archivedFileUseCase)

    const response = await callGet(`workspaceId=${WORKSPACE_ID}&scope=archived`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: FILE_ID,
        name: 'data.csv',
        size: 1024,
        type: 'text/csv',
        key: 'workspace/ws/1-x-data.csv',
        folderPath: '/',
        uploadedByEmail: 'ada@example.com',
        uploadedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        deletedAt: '2024-01-03T00:00:00.000Z',
        share: SHARE,
      },
    })
    expect(mocks.readMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: auth.principal,
        input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID, includeDeleted: true },
      })
    )
  })

  it('still conceals an unauthorized archived read behind the same 404', async () => {
    mocks.readMetadata.mockRejectedValue(new NoWorkspaceAccessError())

    const response = await callGet(`workspaceId=${WORKSPACE_ID}&scope=archived`)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
    /**
     * `includeDeleted: true` is what makes this the *archived* read being
     * concealed rather than the plain cross-workspace 404 the suite already
     * pins: without it the request never reaches the archived set and the test
     * proves only `NoWorkspaceAccessError → 404`.
     */
    expect(mocks.readMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: auth.principal,
        input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID, includeDeleted: true },
      })
    )
  })

  it('rejects an unrecognized scope before reaching the use case', async () => {
    const response = await callGet(`workspaceId=${WORKSPACE_ID}&scope=all`)

    expect(response.status).toBe(400)
    expect(mocks.readMetadata).not.toHaveBeenCalled()
  })

  it('returns a null share when the file has no share configuration', async () => {
    mocks.readMetadata.mockResolvedValueOnce({ file: buildRecord(), share: null })

    const response = await callGet(`workspaceId=${WORKSPACE_ID}`)

    expect(response.status).toBe(200)
    expect((await response.json()).data.share).toBeNull()
  })
})
