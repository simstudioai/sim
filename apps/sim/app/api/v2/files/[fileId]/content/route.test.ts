/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admit: vi.fn(),
  updateContent: vi.fn(),
  authenticateV2ApiKey: vi.fn(),
  checkRateLimitDirect: vi.fn(),
  checkRateLimitDirectOrThrow: vi.fn(),
  getUserEmailsByIds: vi.fn(),
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  MAX_WORKSPACE_FILE_INLINE_BODY_BYTES: 70 * 1024 * 1024,
}))

vi.mock('@/lib/workspace-files/application/update-workspace-file-content', () => ({
  admitUpdateWorkspaceFileContent: mocks.admit,
  updateWorkspaceFileContent: {
    operation: { id: 'files.update_content', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.updateContent,
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

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mocks.getUserEmailsByIds,
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId)!,
}))

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PUT } from '@/app/api/v2/files/[fileId]/content/route'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'
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
const record = {
  id: FILE_ID,
  workspaceId: WORKSPACE_ID,
  name: 'data.csv',
  key: 'workspace/ws/1-x-data.csv',
  path: '/api/files/serve/x',
  size: 8,
  type: 'text/csv',
  uploadedBy: 'user-1',
  folderId: null,
  uploadedAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-03T00:00:00Z'),
}

const callPut = (body: unknown, contentLength?: number) =>
  PUT(
    new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/content`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(contentLength === undefined ? {} : { 'Content-Length': String(contentLength) }),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ fileId: FILE_ID }) }
  )

describe('PUT /api/v2/files/[fileId]/content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateV2ApiKey.mockResolvedValue(auth)
    mocks.checkRateLimitDirect.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt: new Date('2024-01-01T01:00:00Z'),
    })
    mocks.checkRateLimitDirectOrThrow.mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetAt: new Date('2024-01-01T01:00:00Z'),
    })
    mocks.admit.mockResolvedValue(undefined)
    mocks.updateContent.mockResolvedValue({ file: record })
    mocks.getUserEmailsByIds.mockResolvedValue(new Map([['user-1', 'ada@example.com']]))
  })

  it('performs authenticated admission before parsing a large or malformed body', async () => {
    mocks.admit.mockRejectedValue(new NoWorkspaceAccessError())

    const response = await callPut('{not-json')

    expect(response.status).toBe(404)
    expect(mocks.admit).toHaveBeenCalledWith(auth.principal, FILE_ID)
    expect(mocks.updateContent).not.toHaveBeenCalled()
  })

  it('validates body fields after admission', async () => {
    const response = await callPut({ workspaceId: WORKSPACE_ID })

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('BAD_REQUEST')
    expect(mocks.updateContent).not.toHaveBeenCalled()
  })

  it('returns an oversized body in the canonical v2 envelope', async () => {
    const response = await callPut({ workspaceId: WORKSPACE_ID, content: '' }, 70 * 1024 * 1024 + 1)

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    })
    expect(mocks.admit).toHaveBeenCalled()
    expect(mocks.updateContent).not.toHaveBeenCalled()
  })

  it('replaces content through the shared use case and returns the v2 projection', async () => {
    const request = new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, content: 'id,name\n' }),
    })
    const response = await PUT(request, { params: Promise.resolve({ fileId: FILE_ID }) })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: FILE_ID,
        name: 'data.csv',
        size: 8,
        type: 'text/csv',
        key: 'workspace/ws/1-x-data.csv',
        folderPath: '/',
        uploadedByEmail: 'ada@example.com',
        uploadedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-03T00:00:00.000Z',
      },
    })
    expect(mocks.updateContent).toHaveBeenCalledWith({
      principal: auth.principal,
      input: {
        fileId: FILE_ID,
        assertedWorkspaceId: WORKSPACE_ID,
        content: 'id,name\n',
        encoding: 'utf-8',
      },
      request,
    })
    expect(mocks.checkRateLimitDirectOrThrow).toHaveBeenCalledWith(
      'v2:files.update_content:api-key:key-1',
      expect.anything()
    )
  })

  it('maps typed quota failures to 413', async () => {
    mocks.updateContent.mockRejectedValue(
      new OrchestrationError('payload_too_large', 'Storage limit exceeded')
    )

    const response = await callPut({ workspaceId: WORKSPACE_ID, content: 'id,name\n' })

    expect(response.status).toBe(413)
    expect((await response.json()).error.code).toBe('PAYLOAD_TOO_LARGE')
  })
})
