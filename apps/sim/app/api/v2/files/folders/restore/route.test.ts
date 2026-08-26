/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/workspace-file-folders', () => ({
  restoreWorkspaceFileFolderOperation: {
    operation: { id: 'files.folders.restore', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.restore,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/v2/files/folders/restore/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'

const AUTH = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

function restoreRequest(
  body: Record<string, unknown> = { workspaceId: WORKSPACE_ID, path: '/Engineering/Archive' }
) {
  return new NextRequest('http://localhost:3000/api/v2/files/folders/restore', {
    method: 'POST',
    headers: { 'x-api-key': 'secret', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v2/files/folders/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.restore.mockResolvedValue({
      folder: {
        name: 'Archive',
        path: 'Engineering/Archive',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      },
      restoredItems: { files: 7, folders: 2 },
    })
  })

  it('restores an archived folder tree addressed by path', async () => {
    const response = await POST(restoreRequest(), context())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        folder: {
          name: 'Archive',
          path: '/Engineering/Archive',
          parentPath: '/Engineering',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
        restoredItems: { files: 7, folders: 2 },
      },
    })
  })

  /** Path-addressed like the rest of the v2 folder family; ids stay internal. */
  it('forwards the path, never a folder id', async () => {
    await POST(restoreRequest(), context())

    expect(mocks.restore).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { workspaceId: WORKSPACE_ID, path: '/Engineering/Archive' },
      })
    )
  })

  it('rejects restoring the workspace root', async () => {
    const response = await POST(restoreRequest({ workspaceId: WORKSPACE_ID, path: '/' }), context())

    expect(response.status).toBe(400)
    expect(mocks.restore).not.toHaveBeenCalled()
  })

  it('rejects a body with an undeclared key', async () => {
    const response = await POST(
      restoreRequest({ workspaceId: WORKSPACE_ID, path: '/Engineering', folderId: 'folder-1' }),
      context()
    )

    expect(response.status).toBe(400)
    expect(mocks.restore).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await POST(restoreRequest(), context())

    expect(response.status).toBe(401)
    expect(mocks.restore).not.toHaveBeenCalled()
  })

  it('answers 404 for a path that is not archived', async () => {
    mocks.restore.mockRejectedValueOnce(new OrchestrationError('not_found', 'Folder not found'))

    const response = await POST(restoreRequest(), context())

    expect(response.status).toBe(404)
  })

  it('answers 403 for a cross-tenant workspace', async () => {
    mocks.restore.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await POST(restoreRequest(), context())

    expect(response.status).toBe(403)
  })
})

function context() {
  return { params: Promise.resolve({}) }
}
