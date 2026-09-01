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
  list: vi.fn(),
  create: vi.fn(),
  getUserEmailsByIds: vi.fn(),
  getMaxRowsPerTable: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/table/application/tables', () => ({
  listTablesUseCase: { operation: { id: 'tables.list' }, execute: mocks.list },
  createTableUseCase: { operation: { id: 'tables.create' }, execute: mocks.create },
}))
vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mocks.getUserEmailsByIds,
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId)!,
}))
vi.mock('@/lib/table/billing', () => ({
  getMaxRowsPerTable: mocks.getMaxRowsPerTable,
}))

import { v2ListTablesContract } from '@/lib/api/contracts/v2/tables'
import { cursorRoute, cursorScopeKey, REFILTERED_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { writeSortedCursor } from '@/app/api/v2/lib/response'
import { GET, POST } from '@/app/api/v2/tables/route'

const WORKSPACE_ID = 'workspace-1'
const principal = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}
const auth = {
  principal,
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const table = {
  id: 'table-1',
  workspaceId: WORKSPACE_ID,
  createdBy: 'owner-1',
  name: 'Contacts',
  description: null,
  schema: {
    columns: [
      { id: 'col-1', name: 'Name', type: 'string' as const, required: false, unique: false },
    ],
  },
  rowCount: 0,
  maxRows: 100,
  folderId: null,
  metadata: null,
  locks: {
    schemaLocked: false,
    insertLocked: false,
    updateLocked: false,
    deleteLocked: false,
  },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

describe('/api/v2/tables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.getUserEmailsByIds.mockResolvedValue(new Map([['owner-1', 'owner@example.com']]))
    mocks.getMaxRowsPerTable.mockResolvedValue(5000)
    mocks.list.mockResolvedValue({
      tables: [{ table, folderPath: '/' }],
      nextKeys: undefined,
      sortBy: 'name',
      sortOrder: 'asc',
    })
    mocks.create.mockResolvedValue({ table, folderPath: '/' })
  })

  /**
   * The cursor a page mints is bound to the filters that produced it, so
   * resuming it under a different `search` or `folderPath` is a 400 rather than
   * a page silently sequenced against rows the new filter excludes. Pins the
   * binding end-to-end — both the mint in `present` and the read in `mapInput` —
   * because the contract-level sweep only checks a hand-maintained map of param
   * names and stays green when a route drops the stamp entirely.
   */
  it('refuses a cursor minted under a different filter', async () => {
    mocks.list.mockResolvedValue({
      tables: [{ table, folderPath: '/' }],
      nextKeys: ['Contacts', 'table-1'],
      sortBy: 'name',
      sortOrder: 'asc',
    })

    const minted = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/tables?workspaceId=${WORKSPACE_ID}&limit=25&search=alpha`
      )
    )
    const { nextCursor } = await minted.json()
    expect(nextCursor).toEqual(expect.any(String))

    mocks.list.mockClear()
    const replayed = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/tables?workspaceId=${WORKSPACE_ID}&limit=25&search=beta&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(replayed.status).toBe(400)
    expect((await replayed.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('resumes a cursor replayed under the filters it was minted with', async () => {
    mocks.list.mockResolvedValue({
      tables: [{ table, folderPath: '/' }],
      nextKeys: ['Contacts', 'table-1'],
      sortBy: 'name',
      sortOrder: 'asc',
    })

    const minted = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/tables?workspaceId=${WORKSPACE_ID}&limit=25&search=alpha`
      )
    )
    const { nextCursor } = await minted.json()

    mocks.list.mockClear()
    const resumed = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/tables?workspaceId=${WORKSPACE_ID}&limit=25&search=alpha&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(resumed.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({ after: ['Contacts', 'table-1'] }),
      request: expect.anything(),
    })
  })

  /**
   * `scope` carries `.default('active')`, so it is present on every parsed
   * query. Stamping it unconditionally would put a constant in every
   * fingerprint and refuse every cursor minted before the param existed, with
   * the misleading {@link REFILTERED_CURSOR_MESSAGE} — a caller that changed
   * nothing would be told it changed a filter. The default must therefore
   * contribute nothing to the scope.
   */
  it('resumes a cursor minted before scope entered the binding', async () => {
    mocks.list.mockResolvedValue({
      tables: [{ table, folderPath: '/' }],
      nextKeys: undefined,
      sortBy: 'createdAt',
      sortOrder: 'asc',
    })
    const legacyCursor = writeSortedCursor(
      ['2026-08-01T00:00:00.000Z', 'table-1'],
      'createdAt',
      'asc',
      cursorScopeKey(cursorRoute(v2ListTablesContract), { workspaceId: WORKSPACE_ID })
    ) as string

    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/tables?workspaceId=${WORKSPACE_ID}&cursor=${encodeURIComponent(legacyCursor)}`
      )
    )

    expect(response.status).toBe(200)
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ after: ['2026-08-01T00:00:00.000Z', 'table-1'] }),
      })
    )
  })

  it('lists through the semantic use case and preserves the cursor envelope', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/tables?workspaceId=${WORKSPACE_ID}&limit=25`
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: [
        {
          id: 'table-1',
          webUrl: `https://test.sim.ai/workspace/${WORKSPACE_ID}/tables/table-1`,
          folderPath: '/',
          description: null,
          ownerEmail: 'owner@example.com',
          maxRows: 5000,
        },
      ],
      nextCursor: null,
    })
    expect(mocks.list).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({ workspaceId: WORKSPACE_ID, limit: 25 }),
      request,
    })
  })

  it('authenticates and rate-limits before rejecting invalid query input', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/v2/tables'))

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalled()
    expect(v2RouteMocks.operationRate).toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/tables?workspaceId=${WORKSPACE_ID}&limit=25`)
    )

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })

  it('maps operation rate-limit infrastructure failures to service unavailable', async () => {
    v2RouteMocks.operationRate.mockRejectedValueOnce(new Error('rate store unavailable'))

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/tables?workspaceId=${WORKSPACE_ID}&limit=25`)
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable',
      },
    })
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('creates through the shared use case and keeps the 201 response contract', async () => {
    const request = new NextRequest('http://localhost:3000/api/v2/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        name: 'Contacts',
        schema: { columns: [{ name: 'Name', type: 'string' }] },
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(201)
    expect((await response.json()).data).toMatchObject({
      id: 'table-1',
      ownerEmail: 'owner@example.com',
      maxRows: 5000,
    })
    expect(mocks.create).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({ workspaceId: WORKSPACE_ID, name: 'Contacts' }),
      request,
    })
  })

  it('forwards required on a table column to the use case', async () => {
    const request = new NextRequest('http://localhost:3000/api/v2/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        name: 'Contacts',
        schema: { columns: [{ name: 'Name', type: 'string', required: true }] },
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          schema: { columns: [{ name: 'Name', type: 'string', required: true }] },
        }),
      })
    )
  })

  /**
   * A quota ceiling and a permission refusal share the `403` status but demand
   * opposite caller behaviour — delete something and retry, versus stop and
   * escalate — so the ceiling names itself rather than leaving a client to
   * string-match the message.
   */
  it('names a workspace table-quota refusal in error.details.code', async () => {
    mocks.create.mockRejectedValueOnce(
      new ForbiddenOperationError(
        'WORKSPACE_RESOURCE_LIMIT_REACHED',
        'Workspace has reached maximum table limit (100)'
      )
    )

    const request = new NextRequest('http://localhost:3000/api/v2/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        name: 'Contacts',
        schema: { columns: [{ name: 'Name', type: 'string', required: true }] },
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: 'FORBIDDEN', details: { code: 'WORKSPACE_RESOURCE_LIMIT_REACHED' } },
    })
  })

  it('rejects an unrecognized key in a table column before calling the use case', async () => {
    const request = new NextRequest('http://localhost:3000/api/v2/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        name: 'Contacts',
        schema: { columns: [{ name: 'Name', type: 'string', requried: true }] },
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
