import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { v1RateLimitContextModuleMock } from '@sim/testing/mocks/v1-route.mock'
import {
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing/mocks/v2-route.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/api/server/rate-limit-context', () => v1RateLimitContextModuleMock)
vi.mock('@/lib/custom-tools/application/use-cases', () => ({
  listWorkspaceCustomToolsUseCase: {
    operation: { id: 'custom_tools.list' },
    execute: mocks.list,
  },
  createWorkspaceCustomToolUseCase: {
    operation: { id: 'custom_tools.create' },
    execute: mocks.create,
  },
}))

import { REFILTERED_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { GET } from '@/app/api/v2/custom-tools/route'

const log = getMockLogger('V2CustomToolsSerialization')

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
const TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'lookup_order',
    parameters: { type: 'object', properties: {} },
  },
}
const tool = {
  id: 'tool-1',
  workspaceId: WORKSPACE_ID,
  userId: 'owner-1',
  title: 'lookup_order',
  schema: TOOL_SCHEMA,
  code: 'return { ok: true }',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}

function request(method: 'GET' | 'POST', url: string, body?: unknown) {
  return createMockRequest({
    method,
    url: `http://localhost:3000${url}`,
    headers: { 'x-api-key': 'key' },
    body,
  })
}

describe('/api/v2/custom-tools', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    v2RouteMocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.list.mockResolvedValue({ tools: [tool] })
    mocks.create.mockResolvedValue({ tool })
  })

  /**
   * Pins the binding end-to-end — the mint in `present` and the read in
   * `mapInput` — because the contract-level sweep only checks a hand-maintained
   * map of param names and stays green when a route drops the stamp entirely.
   */
  it('refuses a cursor minted under a different filter', async () => {
    mocks.list.mockResolvedValue({
      tools: [tool],
      nextCursorKeys: ['2026-01-01T00:00:00.000Z', 'tool-1'],
    })

    const minted = await GET(
      request('GET', `/api/v2/custom-tools?workspaceId=${WORKSPACE_ID}&search=lookup`)
    )
    const { nextCursor } = await minted.json()
    expect(nextCursor).toEqual(expect.any(String))

    mocks.list.mockClear()
    const replayed = await GET(
      request(
        'GET',
        `/api/v2/custom-tools?workspaceId=${WORKSPACE_ID}&search=refund&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(replayed.status).toBe(400)
    expect((await replayed.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  /**
   * Both shapes below are real production rows. A single one of them used to
   * throw out of the shared response validator and 500 the entire page, and
   * because the list is keyset-paginated the caller could never page past it.
   */
  describe('malformed stored rows', () => {
    const malformed = (id: string, schema: unknown) => ({ ...tool, id, title: id, schema })

    async function list() {
      const response = await GET(request('GET', `/api/v2/custom-tools?workspaceId=${WORKSPACE_ID}`))
      return { status: response.status, body: await response.json() }
    }

    it('recovers a schema stored as a stringified JSON object', async () => {
      mocks.list.mockResolvedValue({
        tools: [malformed('stringified', JSON.stringify(TOOL_SCHEMA)), tool],
      })

      const { status, body } = await list()

      expect(status).toBe(200)
      expect(body.data.map((t: { id: string }) => t.id)).toEqual(['stringified', 'tool-1'])
      expect(body.data[0].schema).toEqual(TOOL_SCHEMA)
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Repaired'),
        expect.objectContaining({ toolId: 'stringified', repairs: ['parsed-json-string'] })
      )
    })

    it('recovers a declaration missing the `type` discriminator', async () => {
      mocks.list.mockResolvedValue({
        tools: [malformed('no-type', { function: TOOL_SCHEMA.function }), tool],
      })

      const { status, body } = await list()

      expect(status).toBe(200)
      expect(body.data.map((t: { id: string }) => t.id)).toEqual(['no-type', 'tool-1'])
      expect(body.data[0].schema).toEqual(TOOL_SCHEMA)
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Repaired'),
        expect.objectContaining({
          toolId: 'no-type',
          repairs: ['filled-function-discriminator'],
        })
      )
    })

    it('serves the rest of the page when a row is not safely repairable', async () => {
      mocks.list.mockResolvedValue({
        tools: [
          malformed('unparseable', 'this is not json'),
          malformed('no-parameters-type', {
            type: 'function',
            function: { name: 'x', parameters: { properties: {} } },
          }),
          tool,
        ],
      })

      const { status, body } = await list()

      expect(status).toBe(200)
      expect(body.data.map((t: { id: string }) => t.id)).toEqual(['tool-1'])
      for (const toolId of ['unparseable', 'no-parameters-type']) {
        expect(log.error).toHaveBeenCalledWith(
          expect.stringContaining('cannot be projected'),
          expect.objectContaining({ toolId, workspaceId: WORKSPACE_ID })
        )
      }
    })

    /**
     * The repair guards must be unreachable for a row that already validates —
     * otherwise the recovery path could rewrite rows it was never meant to
     * touch. Pinned on a stored schema carrying an unrelated extension key, so
     * a repair that rebuilt the object rather than leaving it alone would show
     * up as a lost field rather than passing on a shallow shape check.
     */
    it('emits a valid row exactly as stored, with no repair applied', async () => {
      const stored = {
        ...TOOL_SCHEMA,
        'x-vendor': { owner: 'billing' },
        function: { ...TOOL_SCHEMA.function, description: 'Look up an order' },
      }
      mocks.list.mockResolvedValue({ tools: [{ ...tool, schema: stored }] })

      const { status, body } = await list()

      expect(status).toBe(200)
      expect(body.data[0].schema).toEqual(stored)
      expect(log.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('Repaired'),
        expect.anything()
      )
      expect(log.error).not.toHaveBeenCalledWith(
        expect.stringContaining('cannot be projected'),
        expect.anything()
      )
    })

    /**
     * A page whose rows all skip returns `data: []` with a non-null
     * `nextCursor`, so `nextCursor` — never page length — is this list's
     * completeness signal. Pins that the documented client loop terminates and
     * observes every projectable row across an all-skipped page.
     */
    it('lets a client following nextCursor terminate and see every projectable row', async () => {
      const second = { ...tool, id: 'tool-2', title: 'refund_order' }
      const pages = [
        { tools: [tool, malformed('bad-1', 'this is not json')], nextCursorKeys: ['a', 'bad-1'] },
        { tools: [malformed('bad-2', 'this is not json')], nextCursorKeys: ['b', 'bad-2'] },
        { tools: [second] },
      ]
      mocks.list.mockImplementation(async ({ input }) =>
        input.cursorKeys === undefined ? pages[0] : pages[input.cursorKeys[0] === 'a' ? 1 : 2]
      )

      const seen: string[] = []
      const pageSizes: number[] = []
      let cursor: string | null = null
      do {
        expect(pageSizes.length).toBeLessThan(pages.length)
        const query = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
        const response = await GET(
          request('GET', `/api/v2/custom-tools?workspaceId=${WORKSPACE_ID}${query}`)
        )
        expect(response.status).toBe(200)
        const body = await response.json()
        for (const t of body.data) seen.push(t.id)
        pageSizes.push(body.data.length)
        cursor = body.nextCursor
      } while (cursor !== null)

      expect(pageSizes).toEqual([1, 0, 1])
      expect(seen).toEqual(['tool-1', 'tool-2'])
    })
  })
})
