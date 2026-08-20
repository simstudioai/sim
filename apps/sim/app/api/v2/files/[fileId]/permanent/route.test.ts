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
  permanentlyDelete: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/permanently-delete-workspace-file', () => ({
  permanentlyDeleteWorkspaceFileOperation: {
    operation: { id: 'files.delete_permanent', minimumRole: 'admin', workspaceApiKey: 'deny' },
    execute: mocks.permanentlyDelete,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  WorkspaceApiKeyAuthorizationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { DELETE } from '@/app/api/v2/files/[fileId]/permanent/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const FILE_ID = 'wf_doomed'
const context = { params: Promise.resolve({ fileId: FILE_ID }) }

const AUTH = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' },
  rolloutUserId: 'user-1',
  rateLimitSubjectIds: ['api-key:key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

function deleteRequest(query = `workspaceId=${WORKSPACE_ID}`) {
  return new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/permanent?${query}`, {
    method: 'DELETE',
    headers: { 'x-api-key': 'secret' },
  })
}

describe('DELETE /api/v2/files/[fileId]/permanent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.permanentlyDelete.mockResolvedValue({
      id: FILE_ID,
      workspaceId: WORKSPACE_ID,
      name: 'doomed.pdf',
      deleted: true,
      objectDeleted: true,
    })
  })

  it('destroys an archived file', async () => {
    const response = await DELETE(deleteRequest(), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { id: FILE_ID, deleted: true, objectDeleted: true },
    })
  })

  /** An orphaned object is reported, not hidden and not turned into an error. */
  it('reports an orphaned object without failing the request', async () => {
    mocks.permanentlyDelete.mockResolvedValueOnce({
      id: FILE_ID,
      workspaceId: WORKSPACE_ID,
      name: 'doomed.pdf',
      deleted: true,
      objectDeleted: false,
    })

    const response = await DELETE(deleteRequest(), context)

    expect(response.status).toBe(200)
    expect((await response.json()).data.objectDeleted).toBe(false)
  })

  /**
   * The two-step: a live file must be archived first, so no single request can
   * turn a live file into lost bytes.
   */
  it('answers 409 naming the archive step for a live file', async () => {
    mocks.permanentlyDelete.mockRejectedValueOnce(
      new OrchestrationError(
        'conflict',
        `File is not archived. Archive it first with DELETE /api/v2/files/${FILE_ID}`
      )
    )

    const response = await DELETE(deleteRequest(), context)

    expect(response.status).toBe(409)
    expect((await response.json()).error.message).toContain(`DELETE /api/v2/files/${FILE_ID}`)
  })

  /** `admin` puts this out of reach of workspace keys entirely. */
  it('rejects a workspace API key', async () => {
    mocks.permanentlyDelete.mockRejectedValueOnce(new WorkspaceApiKeyAuthorizationError())

    const response = await DELETE(deleteRequest(), context)

    expect(response.status).toBe(403)
  })

  it('rejects a principal without the admin role', async () => {
    mocks.permanentlyDelete.mockRejectedValueOnce(new InsufficientWorkspacePermissionsError())

    const response = await DELETE(deleteRequest(), context)

    expect(response.status).toBe(403)
  })

  it('conceals a cross-tenant file as a missing file', async () => {
    mocks.permanentlyDelete.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await DELETE(deleteRequest(), context)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'File not found' },
    })
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await DELETE(deleteRequest(), context)

    expect(response.status).toBe(401)
    expect(mocks.permanentlyDelete).not.toHaveBeenCalled()
  })

  it('rejects a request missing the workspace scope', async () => {
    const response = await DELETE(deleteRequest(''), context)

    expect(response.status).toBe(400)
    expect(mocks.permanentlyDelete).not.toHaveBeenCalled()
  })
})
