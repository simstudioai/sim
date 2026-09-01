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
  createFile: vi.fn(),
  queryFiles: vi.fn(),
  getUserEmailsByIds: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/create-workspace-file', () => ({
  createWorkspaceFile: {
    operation: { id: 'files.create', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.createFile,
  },
}))

vi.mock('@/lib/workspace-files/application/list-workspace-files', () => ({
  queryWorkspaceFilePage: {
    operation: { id: 'files.list', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.queryFiles,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mocks.getUserEmailsByIds,
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId)!,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET, POST } from '@/app/api/v2/files/route'

const WORKSPACE_ID = 'workspace-1'
const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
  },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const FILE = {
  id: 'wf_1',
  workspaceId: WORKSPACE_ID,
  name: 'notes.md',
  key: `workspace/${WORKSPACE_ID}/notes.md`,
  path: '/api/files/serve/notes.md?context=workspace',
  size: 0,
  type: 'text/markdown',
  uploadedBy: 'user-1',
  folderId: null,
  folderPath: null,
  uploadedAt: new Date('2026-08-04T00:00:00.000Z'),
  updatedAt: new Date('2026-08-05T00:00:00.000Z'),
}

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v2/files', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('/api/v2/files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.queryFiles.mockResolvedValue({
      files: [FILE],
      nextKeys: undefined,
    })
    mocks.createFile.mockResolvedValue({ file: FILE })
    mocks.getUserEmailsByIds.mockResolvedValue(new Map([['user-1', 'ada@example.com']]))
  })

  it('authenticates and charges before validating list input', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/v2/files'))

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalled()
    expect(v2RouteMocks.operationRate).toHaveBeenCalledTimes(2)
    expect(mocks.queryFiles).not.toHaveBeenCalled()
  })

  /**
   * `?limit=` is not `limit` omitted. `Number('') === 0`, and this list clamps
   * out-of-range values, so an unrejected blank reaches the query as `LIMIT 1`
   * and returns a single row where the omitted param returns a hundred — a
   * silently wrong page, not an error. Whitespace-only is the same value.
   */
  it.each(['limit=', 'limit=%20', 'sortBy=', 'cursor='])(
    'rejects the blank query value %s instead of coercing it',
    async (param) => {
      const response = await GET(
        new NextRequest(`http://localhost:3000/api/v2/files?workspaceId=${WORKSPACE_ID}&${param}`)
      )

      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('BAD_REQUEST')
      expect(mocks.queryFiles).not.toHaveBeenCalled()
    }
  )

  it('still applies the documented default when limit is omitted entirely', async () => {
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/files?workspaceId=${WORKSPACE_ID}`)
    )

    expect(response.status).toBe(200)
    expect(mocks.queryFiles).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ limit: 100 }) })
    )
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/files?workspaceId=${WORKSPACE_ID}`)
    )

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })

  it('lists through the shared use case and v2 presenter', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/files?workspaceId=${WORKSPACE_ID}&sortBy=name`
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          id: FILE.id,
          webUrl: `https://test.sim.ai/workspace/${WORKSPACE_ID}/files/${FILE.id}`,
          name: 'notes.md',
          size: 0,
          type: 'text/markdown',
          key: FILE.key,
          folderPath: '/',
          uploadedByEmail: 'ada@example.com',
          uploadedAt: '2026-08-04T00:00:00.000Z',
          updatedAt: '2026-08-05T00:00:00.000Z',
          deletedAt: null,
        },
      ],
      nextCursor: null,
    })
    expect(mocks.queryFiles).toHaveBeenCalledWith({
      principal: auth.principal,
      input: expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        scope: 'active',
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 100,
      }),
      request,
    })
  })

  it('pages the archived set and dates each soft delete when asked for it', async () => {
    mocks.queryFiles.mockResolvedValueOnce({
      files: [{ ...FILE, deletedAt: new Date('2026-08-06T00:00:00.000Z') }],
      nextKeys: undefined,
    })
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/files?workspaceId=${WORKSPACE_ID}&scope=archived`
      )
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data[0].deletedAt).toBe('2026-08-06T00:00:00.000Z')
    expect(mocks.queryFiles).toHaveBeenCalledWith({
      principal: auth.principal,
      input: expect.objectContaining({ scope: 'archived' }),
      request: expect.anything(),
    })
  })

  it('rejects an unimplemented scope instead of silently listing the active set', async () => {
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/files?workspaceId=${WORKSPACE_ID}&scope=all`)
    )

    expect(response.status).toBe(400)
    expect(mocks.queryFiles).not.toHaveBeenCalled()
  })

  it('preserves escaped slashes in the containing folder path', async () => {
    mocks.queryFiles.mockResolvedValueOnce({
      files: [{ ...FILE, folderId: 'folder-1', folderPath: 'Finance\\/Legal' }],
      nextKeys: undefined,
    })
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/files?workspaceId=${WORKSPACE_ID}`)
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data[0].folderPath).toBe('/Finance%2FLegal')
  })

  /**
   * A keyset cursor stays *coherent* under a changed filter, which is what makes
   * it dangerous: replaying it under a narrowed `search` returns a correctly
   * ordered page of the new matches that happen to sort after the old position,
   * and silently omits every match before it. The caller sees an opaque token
   * and a short page, and reads that as "almost nothing matched".
   */
  it.each([
    ['search', 'search=quarterly'],
    ['scope', 'scope=archived'],
    ['folderPath', 'folderPath=/Finance'],
  ])('refuses a cursor replayed under a different %s', async (_filter, param) => {
    mocks.queryFiles.mockResolvedValueOnce({ files: [FILE], nextKeys: ['notes.md', FILE.id] })
    const firstPage = await (
      await GET(new NextRequest(`http://localhost:3000/api/v2/files?workspaceId=${WORKSPACE_ID}`))
    ).json()
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    mocks.queryFiles.mockClear()

    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/files?workspaceId=${WORKSPACE_ID}&${param}&cursor=${encodeURIComponent(firstPage.nextCursor)}`
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', message: expect.stringContaining('requested filters') },
    })
    expect(mocks.queryFiles).not.toHaveBeenCalled()
  })

  /**
   * `limit` is not part of the binding: it selects how much of the sequence to
   * return, not what the sequence is.
   */
  it('resumes a cursor under an unchanged filter and a changed page size', async () => {
    mocks.queryFiles.mockResolvedValueOnce({ files: [FILE], nextKeys: ['notes.md', FILE.id] })
    const firstPage = await (
      await GET(new NextRequest(`http://localhost:3000/api/v2/files?workspaceId=${WORKSPACE_ID}`))
    ).json()
    mocks.queryFiles.mockResolvedValueOnce({ files: [FILE], nextKeys: undefined })

    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/files?workspaceId=${WORKSPACE_ID}&limit=5&cursor=${encodeURIComponent(firstPage.nextCursor)}`
      )
    )

    expect(response.status).toBe(200)
    expect(mocks.queryFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ limit: 5, after: ['notes.md', FILE.id] }),
      })
    )
  })

  it('rejects malformed cursors before the application service', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/files?workspaceId=${WORKSPACE_ID}&cursor=not-a-cursor`
      )
    )

    expect(response.status).toBe(400)
    expect(mocks.queryFiles).not.toHaveBeenCalled()
  })

  it('creates through the workspace-key principal without human analytics', async () => {
    const request = createRequest({
      workspaceId: WORKSPACE_ID,
      name: 'notes.md',
      content: 'TQ==',
      encoding: 'base64',
    })
    const response = await POST(request)

    expect(response.status).toBe(201)
    expect((await response.json()).data.name).toBe('notes.md')
    expect(mocks.createFile).toHaveBeenCalledWith({
      principal: auth.principal,
      input: {
        workspaceId: WORKSPACE_ID,
        name: 'notes.md',
        contentType: 'text/markdown',
        content: 'TQ==',
        encoding: 'base64',
        folderPath: '/',
        exactName: true,
      },
      request,
    })
  })

  it('rejects malformed base64 after authentication and rate limiting', async () => {
    const response = await POST(
      createRequest({
        workspaceId: WORKSPACE_ID,
        name: 'notes.md',
        content: 'not-base64!',
        encoding: 'base64',
      })
    )

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalled()
    expect(v2RouteMocks.operationRate).toHaveBeenCalledTimes(2)
    expect(mocks.createFile).not.toHaveBeenCalled()
  })

  it('renders typed conflicts and hides unknown errors', async () => {
    mocks.createFile.mockRejectedValueOnce(new OrchestrationError('conflict', 'Name exists'))
    const conflict = await POST(createRequest({ workspaceId: WORKSPACE_ID, name: 'notes.md' }))
    expect(conflict.status).toBe(409)
    expect((await conflict.json()).error.code).toBe('CONFLICT')

    mocks.createFile.mockRejectedValueOnce(new Error('database details'))
    const unexpected = await POST(createRequest({ workspaceId: WORKSPACE_ID, name: 'notes.md' }))
    expect(unexpected.status).toBe(500)
    expect(await unexpected.json()).toMatchObject({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
})
