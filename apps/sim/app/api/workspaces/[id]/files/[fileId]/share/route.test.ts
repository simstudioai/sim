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
import { GET } from '@/app/api/workspaces/[id]/files/[fileId]/share/route'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'
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

describe('/api/workspaces/[id]/files/[fileId]/share', () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mocks.getShare.mockResolvedValue({ share: SHARE })
    mocks.updateShare.mockResolvedValue({ share: SHARE })
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
})
