import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { usersQueriesMock, usersQueriesMockFns } from '@sim/testing/mocks/users-queries.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admit: vi.fn(),
  editContent: vi.fn(),
  updateContent: vi.fn(),
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

vi.mock('@/lib/workspace-files/application/edit-workspace-file-content', () => ({
  editWorkspaceFileContent: {
    operation: { id: 'files.update_content', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.editContent,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/users/queries', () => usersQueriesMock)

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { PATCH, PUT } from '@/app/api/v2/files/[fileId]/content/route'

const { mockGetUserEmailsByIds } = usersQueriesMockFns

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'
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

const callPatch = (body: unknown, contentLength?: number) =>
  PATCH(
    new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/content`, {
      method: 'PATCH',
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
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.admit.mockResolvedValue(undefined)
    mocks.editContent.mockResolvedValue({ file: record, lineCount: 1 })
    mocks.updateContent.mockResolvedValue({ file: record })
    mockGetUserEmailsByIds.mockResolvedValue(new Map([['user-1', 'ada@example.com']]))
  })

  it('performs authenticated admission before parsing a large or malformed body', async () => {
    mocks.admit.mockRejectedValue(new NoWorkspaceAccessError())

    const response = await callPut('{not-json')

    expect(response.status).toBe(404)
    expect(mocks.admit).toHaveBeenCalledWith(auth.principal, FILE_ID)
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

  it('applies the same oversized-body admission limit to partial edits', async () => {
    const response = await callPatch(
      {
        workspaceId: WORKSPACE_ID,
        edit: { mode: 'search_replace', search: 'old', content: 'new' },
      },
      70 * 1024 * 1024 + 1
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    })
    expect(mocks.admit).toHaveBeenCalled()
    expect(mocks.editContent).not.toHaveBeenCalled()
  })
})
