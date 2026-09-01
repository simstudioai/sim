/**
 * @vitest-environment node
 *
 * POST /api/workspaces refuses a workspace-creation-denied group at two
 * moments: the preflight policy read, and the revocation race the insert
 * detects. Both are the same decision, so both must produce the same body —
 * the preflight one used to answer a bare `{ error }` with no
 * `details.code`, so a client keying off the code saw the capability refusal
 * only in the rarer case.
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGetWorkspaceCreationPolicy, mockCreateWorkspace } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetWorkspaceCreationPolicy: vi.fn(),
  mockCreateWorkspace: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/auth/session-response', () => ({
  getActiveOrganizationId: () => null,
}))

vi.mock('@/lib/workspaces/create', () => ({
  createWorkspace: mockCreateWorkspace,
}))

vi.mock('@/lib/workspaces/list', () => ({
  listWorkspacesForViewer: vi.fn(),
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  recordAudit: vi.fn(),
  AuditAction: { WORKSPACE_CREATED: 'workspace.created' },
  AuditResourceType: { WORKSPACE: 'workspace' },
}))

vi.mock('@/lib/workspaces/policy', async () => {
  class WorkspaceCreationCapabilityWithheldError extends Error {}
  class WorkspaceCreationContextChangedError extends Error {}
  return {
    getWorkspaceCreationPolicy: mockGetWorkspaceCreationPolicy,
    WorkspaceCreationCapabilityWithheldError,
    WorkspaceCreationContextChangedError,
  }
})

import { WorkspaceCreationCapabilityWithheldError } from '@/lib/workspaces/policy'
import { POST } from '@/app/api/workspaces/route'

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
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'A', email: 'a@example.com' },
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

  it('answers the revocation race with the same envelope', async () => {
    mockGetWorkspaceCreationPolicy.mockResolvedValue({ canCreate: true, status: 200 })
    mockCreateWorkspace.mockRejectedValue(new WorkspaceCreationCapabilityWithheldError())

    const response = await POST(createRequest())

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      details: { code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' },
    })
  })

  /** A non-capability block keeps its own reason and status. */
  it('leaves an unrelated policy refusal alone', async () => {
    mockGetWorkspaceCreationPolicy.mockResolvedValue({
      canCreate: false,
      status: 402,
      reason: 'Your organization subscription is inactive.',
      blockedReasonCode: 'organization-subscription-inactive',
    })

    const response = await POST(createRequest())

    expect(response.status).toBe(402)
    const body = await response.json()
    expect(body.error).toBe('Your organization subscription is inactive.')
    expect(body.details).toBeUndefined()
  })
})
