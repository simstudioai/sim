/**
 * @vitest-environment node
 */
import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admit: vi.fn(), updateContent: vi.fn() }))

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

import { StorageLimitExceededError } from '@/lib/billing/storage'
import {
  DelegatedWorkspaceAuthorizationError,
  NoWorkspaceAccessError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PUT } from '@/app/api/workspaces/[id]/files/[fileId]/content/route'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'
const USER = { id: 'user-1', name: 'Test User', email: 'test@sim.ai' }
const PRINCIPAL = { kind: 'session' as const, userId: USER.id, sessionId: 'session-1' }
const RECORD = {
  id: FILE_ID,
  workspaceId: WORKSPACE_ID,
  name: 'notes.md',
  key: `workspace/${WORKSPACE_ID}/notes.md`,
  path: '/api/files/serve/notes.md?context=workspace',
  size: 5,
  type: 'text/markdown',
  uploadedBy: USER.id,
  folderId: null,
  uploadedAt: new Date('2026-08-04T00:00:00.000Z'),
  updatedAt: new Date('2026-08-04T00:00:00.000Z'),
  contentUpdatedAt: new Date('2026-09-03T20:00:01.000Z'),
}

const routeContext = { params: Promise.resolve({ id: WORKSPACE_ID, fileId: FILE_ID }) }

function createRequest(body: unknown, contentLength?: number): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files/${FILE_ID}/content`,
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...(contentLength === undefined ? {} : { 'content-length': String(contentLength) }),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }
  )
}

describe('PUT /api/workspaces/[id]/files/[fileId]/content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: USER, session: { id: 'session-1' } })
    mocks.admit.mockResolvedValue(undefined)
    mocks.updateContent.mockResolvedValue({ file: RECORD })
  })

  it('authenticates before parsing an invalid request body', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await PUT(createRequest('{not-json'), routeContext)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.admit).not.toHaveBeenCalled()
    expect(mocks.updateContent).not.toHaveBeenCalled()
  })

  it('performs cheap file admission before buffering the request body', async () => {
    mocks.admit.mockRejectedValue(
      new OrchestrationError('forbidden', 'Insufficient workspace permissions')
    )

    const response = await PUT(createRequest('{not-json'), routeContext)

    expect(response.status).toBe(403)
    expect(mocks.admit).toHaveBeenCalledWith(PRINCIPAL, FILE_ID)
    expect(mocks.updateContent).not.toHaveBeenCalled()
  })

  it.each([
    new NoWorkspaceAccessError(),
    new WorkspaceApiKeyScopeAuthorizationError(),
    new DelegatedWorkspaceAuthorizationError(),
  ])('conceals a cross-tenant admission denial as an absent file: %s', async (error) => {
    mocks.admit.mockRejectedValue(error)

    const response = await PUT(createRequest('{not-json'), routeContext)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: 'File not found' })
    expect(mocks.updateContent).not.toHaveBeenCalled()
  })

  it('rejects malformed base64 after admission', async () => {
    const response = await PUT(
      createRequest({ content: 'not-base64!', encoding: 'base64' }),
      routeContext
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Validation error' })
    expect(mocks.updateContent).not.toHaveBeenCalled()
  })

  it('accepts empty base64 as a zero-byte replacement', async () => {
    const request = createRequest({ content: '', encoding: 'base64' })
    const response = await PUT(request, routeContext)

    expect(response.status).toBe(200)
    expect(mocks.updateContent).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        fileId: FILE_ID,
        assertedWorkspaceId: WORKSPACE_ID,
        content: '',
        encoding: 'base64',
      },
      request,
    })
  })

  it('passes the content-version precondition to the existing authorized use case', async () => {
    const expectedUpdatedAt = '2026-09-03T20:00:00.000Z'
    const response = await PUT(
      createRequest({ content: 'edited', expectedUpdatedAt }),
      routeContext
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      file: { contentUpdatedAt: RECORD.contentUpdatedAt.toISOString() },
    })
    expect(mocks.updateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: PRINCIPAL,
        input: expect.objectContaining({ expectedUpdatedAt: new Date(expectedUpdatedAt) }),
      })
    )
  })

  it('rejects invalid content-version tokens before performing a write', async () => {
    const response = await PUT(
      createRequest({ content: 'edited', expectedUpdatedAt: 'yesterday' }),
      routeContext
    )
    expect(response.status).toBe(400)
    expect(mocks.updateContent).not.toHaveBeenCalled()
  })

  it('preserves a CAS conflict as 409', async () => {
    mocks.updateContent.mockRejectedValueOnce(new OrchestrationError('conflict', 'File changed'))
    const response = await PUT(
      createRequest({ content: 'edited', expectedUpdatedAt: '2026-09-03T20:00:00.000Z' }),
      routeContext
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: 'File changed' })
  })

  it('allows a base64 JSON body up to what the proxy forwards intact', async () => {
    const response = await PUT(
      createRequest({ content: 'TQ==', encoding: 'base64' }, 10 * 1024 * 1024),
      routeContext
    )

    expect(response.status).toBe(200)
    expect(mocks.updateContent).toHaveBeenCalled()
  })

  /**
   * The route declares a 70 MB inline cap, but Next's proxy truncates a client
   * body past 10 MiB, so the parser clamps to that ceiling and answers 413
   * rather than letting a truncated prefix surface as malformed JSON.
   */
  it('rejects a JSON body above the proxy ceiling after admission', async () => {
    const response = await PUT(createRequest({ content: '' }, 10 * 1024 * 1024 + 1), routeContext)

    expect(response.status).toBe(413)
    expect(mocks.admit).toHaveBeenCalled()
    expect(mocks.updateContent).not.toHaveBeenCalled()
  })

  it('preserves the legacy 402 response when storage quota is exhausted', async () => {
    mocks.updateContent.mockRejectedValueOnce(
      new StorageLimitExceededError('Storage limit exceeded')
    )

    const response = await PUT(createRequest({ content: 'hello' }), routeContext)

    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toEqual({
      error: 'Storage limit exceeded',
    })
  })
})
