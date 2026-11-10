/**
 * POST /api/workspaces refuses a workspace-creation-denied group at two
 * moments: the preflight policy read, and the revocation race the insert
 * detects. Both are the same decision, so both must produce the same body —
 * the preflight one used to answer a bare `{ error }` with no
 * `details.code`, so a client keying off the code saw the capability refusal
 * only in the rarer case.
 */
import { createMockRequest } from '@sim/testing'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import {
  workspacesPolicyMock,
  workspacesPolicyMockFns,
} from '@sim/testing/mocks/workspaces-policy.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateWorkspace,
  mockListWorkspacesEnsuringDefault,
  mockResolveSessionOrganizationLanding,
} = vi.hoisted(() => ({
  mockCreateWorkspace: vi.fn(),
  mockListWorkspacesEnsuringDefault: vi.fn(),
  mockResolveSessionOrganizationLanding: vi.fn(),
}))

vi.mock('@/lib/organizations/application/viewer-organization', () => ({
  ensureViewerOrganization: { execute: vi.fn().mockResolvedValue('org-landing') },
}))

vi.mock('@/lib/workspaces/create', () => ({
  createWorkspace: mockCreateWorkspace,
  listWorkspacesEnsuringDefault: mockListWorkspacesEnsuringDefault,
}))

vi.mock('@/lib/workspaces/list', () => ({
  listWorkspacesForViewer: vi.fn(),
}))

vi.mock('@/lib/organizations/surface', () => ({
  resolveSessionOrganizationLanding: mockResolveSessionOrganizationLanding,
}))

vi.mock('@/lib/posthog/server', () => posthogServerMock)

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/workspaces/policy', () => workspacesPolicyMock)

import { WorkspaceOwnerMissingError } from '@/lib/workspaces/policy'
import { GET, POST } from '@/app/api/workspaces/route'

const mockGetWorkspaceCreationPolicy = workspacesPolicyMockFns.mockGetWorkspaceCreationPolicy

const mockGetSession = authMockFns.mockGetSession

function createRequest() {
  return createMockRequest('POST', { name: 'New workspace' })
}

const deniedPolicy = {
  canCreate: false,
  status: 403,
  reason: 'Your permission group does not allow creating workspaces.',
  blockedReasonCode: 'permission-group-denied',
}

describe('POST /api/workspaces capability refusal', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'A', email: 'a@example.com' },
      session: { id: 'session-1' },
    })
  })

  it('answers the preflight denial with the capability refusal envelope', async () => {
    mockGetWorkspaceCreationPolicy.mockResolvedValue(deniedPolicy)

    const response = await POST(createRequest())

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      details: { code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' },
    })
    expect(mockCreateWorkspace).not.toHaveBeenCalled()
  })

  /**
   * After account deletion the browser's cached session cookie stays valid for
   * a few minutes, and the next list load finds no workspaces and tries to
   * create the default one for a user who no longer exists.
   */
  it('answers a default-workspace insert for a deleted user with 401', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Gone' },
      session: { id: 'session-1' },
    })
    mockListWorkspacesEnsuringDefault.mockRejectedValue(new WorkspaceOwnerMissingError('user-1'))

    const response = await GET(
      createMockRequest('GET', undefined, undefined, 'http://localhost/api/workspaces?scope=active')
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })
})

describe('GET /api/workspaces blocked viewer forwarding', () => {
  const blockedList = {
    workspaces: [],
    lastActiveWorkspaceId: null,
    pinnedWorkspaceIds: [],
    creationPolicy: {
      canCreate: false,
      workspaceMode: 'personal',
      organizationId: null,
      maxWorkspaces: null,
      currentWorkspaceCount: 0,
      reason: null,
    },
  }
  const routeContext = { params: Promise.resolve({}) }
  const listRequest = () =>
    createMockRequest('GET', undefined, {}, 'http://localhost/api/workspaces')

  beforeEach(() => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'A', email: 'a@example.com' },
      session: { id: 'session-1' },
    })
    mockListWorkspacesEnsuringDefault.mockResolvedValue(blockedList)
  })

  it('still returns the list when the organization lookup fails', async () => {
    mockResolveSessionOrganizationLanding.mockRejectedValue(new Error('down'))
    const response = await GET(listRequest(), routeContext)
    expect(response.status).toBe(200)
    expect(await response.json()).not.toHaveProperty('forwardOrganizationId')
  })
})
