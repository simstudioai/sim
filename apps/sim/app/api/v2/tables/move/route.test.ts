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

const mocks = vi.hoisted(() => ({ move: vi.fn(), remove: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/table/application/bulk', () => ({
  bulkMoveTables: { operation: { id: 'tables.bulk_move' }, execute: mocks.move },
  bulkDeleteTables: { operation: { id: 'tables.bulk_delete' }, execute: mocks.remove },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST as BULK_DELETE } from '@/app/api/v2/tables/bulk-delete/route'
import { POST as BULK_MOVE } from '@/app/api/v2/tables/move/route'

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
const EMPTY_OUTCOME = { skipped: [], notFound: [], failed: [] }

function call(handler: (request: NextRequest) => Promise<Response>, path: string, body: unknown) {
  const request = new NextRequest(`http://localhost/api/v2/tables/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
  return { request, response: handler(request) }
}

describe('POST /api/v2/tables/move', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.move.mockResolvedValue({
      moved: [{ kind: 'table', id: 'table-1', name: 'Contacts' }],
      ...EMPTY_OUTCOME,
    })
  })

  it('delegates the selection under path keying without resolving anything itself', async () => {
    const invocation = call(BULK_MOVE, 'bulk-move', {
      workspaceId: WORKSPACE_ID,
      tableIds: ['table-1'],
      folderPaths: ['/Sales'],
      targetFolderPath: '/Revenue',
    })
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(mocks.move).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        assertedWorkspaceId: WORKSPACE_ID,
        folderKeying: 'paths',
        tableIds: ['table-1'],
        folders: ['/Sales'],
        targetFolder: '/Revenue',
      },
      request: invocation.request,
    })
  })

  /**
   * Omission is the workspace root, matching `POST /api/v2/files/move`. The use
   * case still requires an explicit choice, so the route supplies the `null`.
   */
  it('treats an omitted destination as the workspace root', async () => {
    await call(BULK_MOVE, 'bulk-move', {
      workspaceId: WORKSPACE_ID,
      tableIds: ['table-1'],
    }).response

    expect(mocks.move).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ targetFolder: null }) })
    )
  })

  it('rejects an explicit null rather than accepting two spellings of the root', async () => {
    const response = await call(BULK_MOVE, 'bulk-move', {
      workspaceId: WORKSPACE_ID,
      tableIds: ['table-1'],
      targetFolderPath: null,
    }).response

    expect(response.status).toBe(400)
    expect(mocks.move).not.toHaveBeenCalled()
  })

  it('rejects an empty selection before delegation', async () => {
    const response = await call(BULK_MOVE, 'bulk-move', {
      workspaceId: WORKSPACE_ID,
    }).response

    expect(response.status).toBe(400)
    expect(mocks.move).not.toHaveBeenCalled()
  })

  /**
   * These routes name a workspace, not one table, so a refusal has no table
   * existence to conceal — an invalid destination is the caller's to fix and
   * says so.
   */
  it('reports an invalid destination as a 404 naming the folder', async () => {
    mocks.move.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Folder not found in this workspace')
    )

    const response = await call(BULK_MOVE, 'bulk-move', {
      workspaceId: WORKSPACE_ID,
      tableIds: ['table-1'],
      targetFolderPath: '/Ghost',
    }).response

    expect(response.status).toBe(404)
    expect((await response.json()).error.message).toBe('Folder not found in this workspace')
  })

  it('rejects an unauthenticated move before parsing', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await call(BULK_MOVE, 'bulk-move', {
      workspaceId: WORKSPACE_ID,
      tableIds: ['table-1'],
      targetFolderPath: null,
    }).response

    expect(response.status).toBe(401)
    expect(mocks.move).not.toHaveBeenCalled()
  })
})

describe('POST /api/v2/tables/bulk-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.remove.mockResolvedValue({
      deleted: [{ kind: 'folder', id: '/Sales', name: '/Sales' }],
      deletedItems: { tables: 3, folders: 1 },
      ...EMPTY_OUTCOME,
    })
  })

  it('publishes the per-item outcome and the cascade totals', async () => {
    const response = await call(BULK_DELETE, 'bulk-delete', {
      workspaceId: WORKSPACE_ID,
      folderPaths: ['/Sales'],
    }).response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        deleted: [{ kind: 'folder', id: '/Sales', name: '/Sales' }],
        skipped: [],
        notFound: [],
        failed: [],
        deletedItems: { tables: 3, folders: 1 },
      },
    })
  })

  it('rejects a selection past the combined cap before delegation', async () => {
    const response = await call(BULK_DELETE, 'bulk-delete', {
      workspaceId: WORKSPACE_ID,
      tableIds: Array.from({ length: 101 }, (_unused, index) => `table-${index}`),
    }).response

    expect(response.status).toBe(400)
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})
