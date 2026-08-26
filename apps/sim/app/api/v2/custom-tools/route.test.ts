/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, log, MockV2ApiKeyUnauthenticatedError } = vi.hoisted(() => {
  class MockV2ApiKeyUnauthenticatedError extends Error {}
  /**
   * The same surface `createMockLogger` provides, because this stub *replaces*
   * the global `@sim/logger` mock for this file. A narrower one is not merely
   * incomplete — the first module in this route's graph to call `logger.trace`
   * or `logger.child` would throw `TypeError` here and nowhere else, which reads
   * as a route bug rather than a missing mock method. `child`/`withMetadata`
   * return the same instance so a chained call still records on `log`.
   */
  const log: Record<string, unknown> = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  }
  log.child = vi.fn(() => log)
  log.withMetadata = vi.fn(() => log)
  return {
    mocks: {
      authenticate: vi.fn(),
      preauthRate: vi.fn(),
      operationRate: vi.fn(),
      list: vi.fn(),
      create: vi.fn(),
    },
    log: log as {
      info: ReturnType<typeof vi.fn>
      warn: ReturnType<typeof vi.fn>
      error: ReturnType<typeof vi.fn>
      debug: ReturnType<typeof vi.fn>
      trace: ReturnType<typeof vi.fn>
      fatal: ReturnType<typeof vi.fn>
      child: ReturnType<typeof vi.fn>
      withMetadata: ReturnType<typeof vi.fn>
    },
    MockV2ApiKeyUnauthenticatedError,
  }
})

/**
 * Overrides the global logger mock with one stable instance so the malformed-row
 * warnings can be asserted — `createLogger` is called at module load, before any
 * `beforeEach` could capture the per-call mock the global stub returns.
 */
vi.mock('@sim/logger', () => ({
  createLogger: () => log,
  logger: log,
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
}))

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
  listWorkspaceCustomToolsUseCase: {
    operation: { id: 'custom_tools.list' },
    execute: mocks.list,
  },
  createWorkspaceCustomToolUseCase: {
    operation: { id: 'custom_tools.create' },
    execute: mocks.create,
  },
}))

import { V2_DEFAULT_PAGE_SIZE } from '@/lib/api/contracts/v2/shared'
import { REFILTERED_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { GET, POST } from '@/app/api/v2/custom-tools/route'

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
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: {
      'x-api-key': 'key',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('/api/v2/custom-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.list.mockResolvedValue({ tools: [tool] })
    mocks.create.mockResolvedValue({ tool })
  })

  it('lists custom tools through the authorized application use case', async () => {
    const response = await GET(request('GET', `/api/v2/custom-tools?workspaceId=${WORKSPACE_ID}`))

    expect(response.status).toBe(200)
    expect((await response.json()).data[0]).toMatchObject({ id: 'tool-1', title: 'lookup_order' })
    expect(mocks.list).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        limit: V2_DEFAULT_PAGE_SIZE,
        cursorKeys: undefined,
      },
      request: expect.anything(),
    })
    expect(mocks.operationRate).toHaveBeenCalledWith(
      'v2:custom_tools.list:workspace:workspace-1',
      expect.objectContaining({ maxTokens: 100 })
    )
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

  it('resumes a cursor replayed under the filters it was minted with', async () => {
    mocks.list.mockResolvedValue({
      tools: [tool],
      nextCursorKeys: ['2026-01-01T00:00:00.000Z', 'tool-1'],
    })

    const minted = await GET(
      request('GET', `/api/v2/custom-tools?workspaceId=${WORKSPACE_ID}&search=lookup`)
    )
    const { nextCursor } = await minted.json()

    mocks.list.mockClear()
    const resumed = await GET(
      request(
        'GET',
        `/api/v2/custom-tools?workspaceId=${WORKSPACE_ID}&search=lookup&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(resumed.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        search: 'lookup',
        cursorKeys: ['2026-01-01T00:00:00.000Z', 'tool-1'],
      }),
      request: expect.anything(),
    })
  })

  it('creates exactly one custom tool with the v2 source and status', async () => {
    const response = await POST(
      request('POST', '/api/v2/custom-tools', {
        workspaceId: WORKSPACE_ID,
        title: tool.title,
        schema: TOOL_SCHEMA,
        code: tool.code,
      })
    )

    expect(response.status).toBe(201)
    expect((await response.json()).data.id).toBe('tool-1')
    expect(mocks.create).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        title: tool.title,
        schema: TOOL_SCHEMA,
        code: tool.code,
        source: 'api',
      },
      request: expect.anything(),
    })
  })

  it('authenticates before validating a malformed create body', async () => {
    mocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await POST(request('POST', '/api/v2/custom-tools', {}))

    expect(response.status).toBe(401)
    expect(mocks.create).not.toHaveBeenCalled()
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

  it('rejects invalid list sort fields before application execution', async () => {
    const response = await GET(
      request('GET', `/api/v2/custom-tools?workspaceId=${WORKSPACE_ID}&sortBy=invalid`)
    )

    expect(response.status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
