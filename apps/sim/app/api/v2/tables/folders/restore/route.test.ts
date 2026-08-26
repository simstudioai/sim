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

const mocks = vi.hoisted(() => ({ restore: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/table/application/folders', () => ({
  restoreTableFolderUseCase: {
    operation: { id: 'tables.folders.restore' },
    execute: mocks.restore,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/v2/tables/folders/restore/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}
const AUTH = {
  principal: PRINCIPAL,
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

function restored(name: string, path: string) {
  const folder = {
    id: 'folder-1',
    workspaceId: WORKSPACE_ID,
    userId: 'owner-1',
    resourceType: 'table' as const,
    name,
    parentId: null,
    sortOrder: 0,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }
  return {
    folder,
    index: {
      rowById: new Map([['folder-1', folder]]),
      pathById: new Map([['folder-1', path]]),
      idByPath: new Map([[path, 'folder-1']]),
    },
    requestedPath: '/Reports',
    restoredItems: { folders: 2, tables: 5 },
  }
}

function restore(body: unknown) {
  const request = new NextRequest('http://localhost:3000/api/v2/tables/folders/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
  return { request, response: POST(request) }
}

describe('POST /api/v2/tables/folders/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.restore.mockResolvedValue(restored('Reports', '/Reports'))
  })

  it('delegates the workspace and archived path, and reports what came back', async () => {
    const invocation = restore({ workspaceId: WORKSPACE_ID, path: '/Reports' })
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        folder: {
          name: 'Reports',
          path: '/Reports',
          parentPath: '/',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        restoredItems: { folders: 2, tables: 5 },
      },
    })
    expect(mocks.restore).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, path: '/Reports' },
      request: invocation.request,
    })
  })

  /**
   * A folder whose parent is still archived is re-rooted rather than refused, so the response
   * must report where it actually landed instead of echoing the requested path.
   */
  it('reports the re-rooted path when the parent is still archived', async () => {
    mocks.restore.mockResolvedValue(restored('Reports', '/Reports'))

    const response = await restore({
      workspaceId: WORKSPACE_ID,
      path: '/Archive/Reports',
    }).response

    expect(response.status).toBe(200)
    expect((await response.json()).data.folder.path).toBe('/Reports')
  })

  /**
   * A name an active sibling took while the folder was archived is deduplicated, not
   * rejected — the caller cannot rename an archived folder, so a taken name would otherwise
   * make it permanently unrestorable.
   */
  it('reports the deduplicated name when an active sibling holds the original', async () => {
    mocks.restore.mockResolvedValue(restored('Reports (1)', '/Reports%20%281%29'))

    const response = await restore({ workspaceId: WORKSPACE_ID, path: '/Reports' }).response

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.folder.name).toBe('Reports (1)')
    expect(body.data.folder.path).toBe('/Reports%20%281%29')
  })

  it('answers 404 for a path no archived folder holds', async () => {
    mocks.restore.mockRejectedValueOnce(new OrchestrationError('not_found', 'Folder not found'))

    const response = await restore({ workspaceId: WORKSPACE_ID, path: '/Nope' }).response

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })

  it('rejects the workspace root before delegation', async () => {
    const response = await restore({ workspaceId: WORKSPACE_ID, path: '/' }).response

    expect(response.status).toBe(400)
    expect(mocks.restore).not.toHaveBeenCalled()
  })

  it('rejects an unknown body key', async () => {
    const response = await restore({
      workspaceId: WORKSPACE_ID,
      path: '/Reports',
      recursive: true,
    }).response

    expect(response.status).toBe(400)
    expect(mocks.restore).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request before delegation', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await restore({ workspaceId: WORKSPACE_ID, path: '/Reports' }).response

    expect(response.status).toBe(401)
    expect(mocks.restore).not.toHaveBeenCalled()
  })
})
