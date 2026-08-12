/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateV2ApiKey: vi.fn(),
  checkRateLimitDirect: vi.fn(),
  checkRateLimitDirectOrThrow: vi.fn(),
  createFile: vi.fn(),
  queryFiles: vi.fn(),
  getUserEmailsByIds: vi.fn(),
  gate: vi.fn(),
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

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticateV2ApiKey,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: () => ({ maxTokens: 100, refillRate: 50, refillIntervalMs: 60_000 }),
  RateLimiter: class RateLimiter {
    checkRateLimitDirect = mocks.checkRateLimitDirect
    checkRateLimitDirectOrThrow = mocks.checkRateLimitDirectOrThrow
  },
}))

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))

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
  rolloutUserId: 'billing-owner-1',
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
    mocks.authenticateV2ApiKey.mockResolvedValue(auth)
    mocks.gate.mockResolvedValue(null)
    mocks.checkRateLimitDirect.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt: new Date('2026-08-04T01:00:00.000Z'),
    })
    mocks.checkRateLimitDirectOrThrow.mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetAt: new Date('2026-08-04T01:00:00.000Z'),
    })
    mocks.queryFiles.mockResolvedValue({
      files: [FILE],
      nextKeys: undefined,
      cursorSort: 'name:asc',
    })
    mocks.createFile.mockResolvedValue({ file: FILE })
    mocks.getUserEmailsByIds.mockResolvedValue(new Map([['user-1', 'ada@example.com']]))
  })

  it('authenticates and charges before validating list input', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/v2/files'))

    expect(response.status).toBe(400)
    expect(mocks.authenticateV2ApiKey).toHaveBeenCalled()
    expect(mocks.checkRateLimitDirectOrThrow).toHaveBeenCalledTimes(2)
    expect(mocks.queryFiles).not.toHaveBeenCalled()
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
          name: 'notes.md',
          size: 0,
          type: 'text/markdown',
          key: FILE.key,
          folderPath: '/',
          uploadedByEmail: 'ada@example.com',
          uploadedAt: '2026-08-04T00:00:00.000Z',
          updatedAt: '2026-08-05T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })
    expect(mocks.queryFiles).toHaveBeenCalledWith({
      principal: auth.principal,
      input: expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 100,
      }),
      request,
    })
  })

  it('preserves escaped slashes in the containing folder path', async () => {
    mocks.queryFiles.mockResolvedValueOnce({
      files: [{ ...FILE, folderId: 'folder-1', folderPath: 'Finance\\/Legal' }],
      nextKeys: undefined,
      cursorSort: 'name:asc',
    })
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/files?workspaceId=${WORKSPACE_ID}`)
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data[0].folderPath).toBe('/Finance%2FLegal')
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
    expect(mocks.authenticateV2ApiKey).toHaveBeenCalled()
    expect(mocks.checkRateLimitDirectOrThrow).toHaveBeenCalledTimes(2)
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
