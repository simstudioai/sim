/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getShare: vi.fn(),
  updateShare: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))

vi.mock('@/lib/workspace-files/application/share-workspace-file', () => ({
  getWorkspaceFileShare: {
    operation: { id: 'files.share.read', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.getShare,
  },
  updateWorkspaceFileShare: {
    operation: { id: 'files.share.update', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.updateShare,
  },
}))

import {
  DelegatedWorkspaceAuthorizationError,
  NoWorkspaceAccessError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET, PUT } from '@/app/api/workspaces/[id]/files/[fileId]/share/route'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'
const PRINCIPAL = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const SHARE = {
  id: 'shr_1',
  token: 'tok_1',
  url: 'https://sim.ai/f/tok_1',
  isActive: true,
  resourceType: 'file' as const,
  resourceId: FILE_ID,
  authType: 'public' as const,
  hasPassword: false,
  allowedEmails: [] as string[],
}
const context = {
  params: Promise.resolve({ id: WORKSPACE_ID, fileId: FILE_ID }),
}

function getRequest() {
  return new NextRequest(
    `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files/${FILE_ID}/share`
  )
}

function putRequest(body: unknown) {
  return new NextRequest(
    `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files/${FILE_ID}/share`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
}

describe('/api/workspaces/[id]/files/[fileId]/share', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mocks.getShare.mockResolvedValue({ share: SHARE })
    mocks.updateShare.mockResolvedValue({ share: SHARE })
  })

  it('authenticates before parsing or executing', async () => {
    mocks.getSession.mockResolvedValueOnce(null)

    const response = await GET(getRequest(), context)

    expect(response.status).toBe(401)
    expect(mocks.getShare).not.toHaveBeenCalled()
  })

  it('returns the share through the internal envelope', async () => {
    const response = await GET(getRequest(), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ share: SHARE })
    expect(mocks.getShare).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID },
      request: expect.anything(),
    })
  })

  it('renders authorization failures as 403', async () => {
    mocks.getShare.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Access denied'))

    const response = await GET(getRequest(), context)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Access denied' })
  })

  it.each([
    new NoWorkspaceAccessError(),
    new WorkspaceApiKeyScopeAuthorizationError(),
    new DelegatedWorkspaceAuthorizationError(),
  ])('conceals a cross-tenant denial as an absent file: %s', async (error) => {
    mocks.getShare.mockRejectedValueOnce(error)

    const response = await GET(getRequest(), context)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'File not found' })
  })

  it('renders resource absence as 404', async () => {
    mocks.getShare.mockRejectedValueOnce(new OrchestrationError('not_found', 'File not found'))

    const response = await GET(getRequest(), context)

    expect(response.status).toBe(404)
  })

  it('rejects malformed update input before the use case', async () => {
    const response = await PUT(putRequest({}), context)

    expect(response.status).toBe(400)
    expect(mocks.updateShare).not.toHaveBeenCalled()
  })

  it('passes the session principal and asserted workspace to the shared update use case', async () => {
    const response = await PUT(putRequest({ isActive: true, authType: 'password' }), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ share: SHARE })
    expect(mocks.updateShare).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        fileId: FILE_ID,
        assertedWorkspaceId: WORKSPACE_ID,
        isActive: true,
        authType: 'password',
        password: undefined,
        allowedEmails: undefined,
        token: undefined,
      },
      request: expect.anything(),
    })
  })

  it('renders typed update failures without exposing a 500', async () => {
    mocks.updateShare.mockRejectedValueOnce(
      new OrchestrationError('validation', 'Password is required')
    )

    const response = await PUT(putRequest({ isActive: true }), context)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Password is required' })
  })

  it('preserves the internal caller-supplied token field for compatibility', async () => {
    await PUT(
      putRequest({
        isActive: true,
        token: 'client-reserved-token',
      }),
      context
    )

    expect(mocks.updateShare).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ token: 'client-reserved-token' }),
      })
    )
  })
})
