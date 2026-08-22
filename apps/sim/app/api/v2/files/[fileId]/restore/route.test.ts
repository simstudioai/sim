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
  restoreFile: vi.fn(),
  getUserEmailsByIds: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/restore-workspace-file', () => ({
  restoreWorkspaceFileOperation: {
    operation: { id: 'files.restore', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.restoreFile,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mocks.getUserEmailsByIds,
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId)!,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/v2/files/[fileId]/restore/route'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'

const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
  },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

/** The post-restore record: renamed away from the taken name, back at the root. */
const RESTORED_FILE = {
  id: FILE_ID,
  workspaceId: WORKSPACE_ID,
  name: 'notes_restored.md',
  key: `workspace/${WORKSPACE_ID}/notes.md`,
  path: '/api/files/serve/notes.md?context=workspace',
  size: 12,
  type: 'text/markdown',
  uploadedBy: 'user-1',
  folderId: null,
  folderPath: null,
  deletedAt: null,
  uploadedAt: new Date('2026-08-04T00:00:00.000Z'),
  updatedAt: new Date('2026-08-07T00:00:00.000Z'),
}

function restoreRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
}

function post(body: unknown) {
  return POST(restoreRequest(body), { params: Promise.resolve({ fileId: FILE_ID }) })
}

describe('POST /api/v2/files/[fileId]/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.restoreFile.mockResolvedValue({ restored: true, file: RESTORED_FILE })
    mocks.getUserEmailsByIds.mockResolvedValue(new Map([['user-1', 'ada@example.com']]))
  })

  it('returns the post-restore record so the caller sees the new name and root placement', async () => {
    const response = await post({ workspaceId: WORKSPACE_ID })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: FILE_ID,
        name: 'notes_restored.md',
        size: 12,
        type: 'text/markdown',
        key: RESTORED_FILE.key,
        folderPath: '/',
        uploadedByEmail: 'ada@example.com',
        uploadedAt: '2026-08-04T00:00:00.000Z',
        updatedAt: '2026-08-07T00:00:00.000Z',
        deletedAt: null,
      },
    })
    expect(mocks.restoreFile).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID },
      request: expect.anything(),
    })
  })

  it('conceals a file in another workspace as 404 rather than confirming it exists', async () => {
    mocks.restoreFile.mockRejectedValueOnce(new OrchestrationError('not_found', 'File not found'))

    const response = await post({ workspaceId: WORKSPACE_ID })

    expect(response.status).toBe(404)
    expect((await response.json()).error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'File not found',
    })
  })

  it('rejects an unknown body key instead of ignoring it', async () => {
    const response = await post({ workspaceId: WORKSPACE_ID, folderPath: '/Engineering' })

    expect(response.status).toBe(400)
    expect(mocks.restoreFile).not.toHaveBeenCalled()
  })

  it('authenticates and charges before validating the body', async () => {
    const response = await post({})

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalled()
    expect(v2RouteMocks.operationRate).toHaveBeenCalledTimes(2)
    expect(mocks.restoreFile).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await post({ workspaceId: WORKSPACE_ID })

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})
