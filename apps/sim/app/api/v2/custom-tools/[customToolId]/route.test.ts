import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { v1RateLimitContextModuleMock } from '@sim/testing/mocks/v1-route.mock'
import {
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing/mocks/v2-route.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/api/server/rate-limit-context', () => v1RateLimitContextModuleMock)
vi.mock('@/lib/custom-tools/application/use-cases', () => ({
  getWorkspaceCustomToolUseCase: { operation: { id: 'custom_tools.read' }, execute: mocks.get },
  updateWorkspaceCustomToolUseCase: {
    operation: { id: 'custom_tools.update' },
    execute: mocks.update,
  },
  deleteWorkspaceCustomToolUseCase: {
    operation: { id: 'custom_tools.delete' },
    execute: mocks.remove,
  },
}))

import { DELETE, GET, PATCH } from '@/app/api/v2/custom-tools/[customToolId]/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = createWorkspaceApiKeyPrincipal({ workspaceId: WORKSPACE_ID })
const AUTH = {
  principal: PRINCIPAL,
  rateLimitSubjectIds: ['workspace:workspace-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const RATE_LIMIT_OK = {
  allowed: true,
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-01-01T00:00:00Z'),
  retryAfterMs: 0,
}
const tool = {
  id: 'tool-1',
  workspaceId: WORKSPACE_ID,
  userId: 'owner-1',
  title: 'lookup_order',
  schema: {
    type: 'function',
    function: { name: 'lookup_order', parameters: { type: 'object', properties: {} } },
  },
  code: 'return { ok: true }',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}
const context = createRouteContext({ customToolId: tool.id })

/**
 * The read and delete verbs scope themselves with `?workspaceId=`; the write
 * verb carries `workspaceId` in its body. Sending the query copy on a write is
 * now a 400 rather than a silently dropped key, so the helper only appends it
 * where the contract declares it.
 */
function request(method: 'GET' | 'PATCH' | 'DELETE', body?: unknown) {
  const query = method === 'PATCH' ? '' : `?workspaceId=${WORKSPACE_ID}`
  return createMockRequest({
    method,
    url: `http://localhost:3000/api/v2/custom-tools/${tool.id}${query}`,
    headers: { 'x-api-key': 'key' },
    body,
  })
}

describe('/api/v2/custom-tools/[customToolId]', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    v2RouteMocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.get.mockResolvedValue({ tool })
    mocks.update.mockResolvedValue({ tool })
    mocks.remove.mockResolvedValue({ tool })
  })

  /**
   * The list omits a row it cannot project, so this surface must not answer the
   * same row with a 500 — a caller who lists and sees nothing, then fetches by
   * id and sees a server fault, can act on neither answer. Both surfaces say
   * "not addressable here"; the recoveries (DELETE, or a PATCH carrying a valid
   * schema) do not go through the projection and still work.
   */
  describe('a stored row that cannot be projected onto the contract', () => {
    const unrepairable = { ...tool, schema: 'this is not json' }
    const repairable = { ...tool, schema: JSON.stringify(tool.schema) }

    it('answers a read with the same 404 the list implies by omitting it', async () => {
      mocks.get.mockResolvedValue({ tool: unrepairable })

      const response = await GET(request('GET'), context)

      expect(response.status).toBe(404)
      expect((await response.json()).error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Custom tool not found',
      })
    })

    it('answers a write with the same 404, leaving delete and a full-schema patch as the recoveries', async () => {
      mocks.update.mockResolvedValue({ tool: unrepairable })
      expect(
        (await PATCH(request('PATCH', { workspaceId: WORKSPACE_ID, code: 'return 2' }), context))
          .status
      ).toBe(404)

      mocks.remove.mockResolvedValue({ tool: unrepairable })
      expect((await DELETE(request('DELETE'), context)).status).toBe(200)
    })

    it('serves a repairable row on both single-resource verbs', async () => {
      mocks.get.mockResolvedValue({ tool: repairable })
      const read = await GET(request('GET'), context)
      expect(read.status).toBe(200)
      expect((await read.json()).data.schema).toEqual(tool.schema)

      mocks.update.mockResolvedValue({ tool: repairable })
      const written = await PATCH(
        request('PATCH', { workspaceId: WORKSPACE_ID, code: 'return 2' }),
        context
      )
      expect(written.status).toBe(200)
      expect((await written.json()).data.schema).toEqual(tool.schema)
    })
  })

  it('conceals cross-tenant access while preserving same-workspace role denials', async () => {
    mocks.get.mockRejectedValueOnce(new NoWorkspaceAccessError())
    expect((await GET(request('GET'), context)).status).toBe(404)

    mocks.update.mockRejectedValueOnce(new InsufficientWorkspacePermissionsError())
    expect(
      (await PATCH(request('PATCH', { workspaceId: WORKSPACE_ID, code: 'return 2' }), context))
        .status
    ).toBe(403)
  })
})
