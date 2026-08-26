/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application'

const { mocks, MockV2ApiKeyUnauthenticatedError } = vi.hoisted(() => {
  class MockV2ApiKeyUnauthenticatedError extends Error {}
  return {
    mocks: {
      authenticate: vi.fn(),
      preauthRate: vi.fn(),
      operationRate: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
    MockV2ApiKeyUnauthenticatedError,
  }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: MockV2ApiKeyUnauthenticatedError,
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mocks.preauthRate
    checkRateLimitDirectOrThrow = mocks.operationRate
  },
  getRateLimit: vi.fn().mockReturnValue({
    maxTokens: 100,
    refillRate: 100,
    refillIntervalMs: 60_000,
  }),
}))
vi.mock('@/lib/api/server/rate-limit-context', () => ({
  recordRateLimitSnapshot: vi.fn(),
  getRateLimitHeaders: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('request-1'),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}))
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
const PRINCIPAL = { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' }
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
const context = { params: Promise.resolve({ customToolId: tool.id }) }

/**
 * The read and delete verbs scope themselves with `?workspaceId=`; the write
 * verb carries `workspaceId` in its body. Sending the query copy on a write is
 * now a 400 rather than a silently dropped key, so the helper only appends it
 * where the contract declares it.
 */
function request(method: 'GET' | 'PATCH' | 'DELETE', body?: unknown) {
  const query = method === 'PATCH' ? '' : `?workspaceId=${WORKSPACE_ID}`
  return new NextRequest(`http://localhost:3000/api/v2/custom-tools/${tool.id}${query}`, {
    method,
    headers: {
      'x-api-key': 'key',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('/api/v2/custom-tools/[customToolId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.get.mockResolvedValue({ tool })
    mocks.update.mockResolvedValue({ tool })
    mocks.remove.mockResolvedValue({ tool })
  })

  it('gets a custom tool through its semantic read operation', async () => {
    const response = await GET(request('GET'), context)

    expect(response.status).toBe(200)
    expect(mocks.get).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, toolId: tool.id },
      request: expect.anything(),
    })
  })

  /**
   * Every list in this family rejects a query param it does not implement, so
   * the single-resource reads must too. A caller who mistypes a flag otherwise
   * gets a 200 that silently ignored it, which reads as confirmation the flag
   * exists and does nothing.
   */
  it('rejects a query param it does not implement', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/custom-tools/${tool.id}?workspaceId=${WORKSPACE_ID}&includeCodes=true`,
        { method: 'GET', headers: { 'x-api-key': 'key' } }
      ),
      context
    )

    expect(response.status).toBe(400)
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('updates a custom tool through its semantic update operation', async () => {
    const response = await PATCH(
      request('PATCH', { workspaceId: WORKSPACE_ID, code: 'return 2' }),
      context
    )

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, toolId: tool.id, code: 'return 2', source: 'api' },
      request: expect.anything(),
    })
  })

  it('deletes a custom tool through its semantic delete operation', async () => {
    const response = await DELETE(request('DELETE'), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { id: tool.id, deleted: true } })
    expect(mocks.remove).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, toolId: tool.id, source: 'api' },
      request: expect.anything(),
    })
  })

  it('authenticates before validating an empty patch body', async () => {
    mocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await PATCH(request('PATCH', {}), context)

    expect(response.status).toBe(401)
    expect(mocks.update).not.toHaveBeenCalled()
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
