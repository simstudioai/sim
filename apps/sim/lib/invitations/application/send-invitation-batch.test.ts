/**
 * @vitest-environment node
 */
import { user } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { batchWorkspaceInvitationBodySchema } from '@/lib/api/contracts/invitations'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'

const mocks = vi.hoisted(() => ({
  orgContext: vi.fn(),
  workspaceContext: vi.fn(),
  orgSend: vi.fn(),
  workspaceSend: vi.fn(),
}))
vi.mock('@/lib/invitations/organization-invitations', () => ({
  prepareOrganizationInvitationContext: mocks.orgContext,
  createOrganizationInvitation: mocks.orgSend,
}))
vi.mock('@/lib/invitations/workspace-invitations', () => ({
  prepareWorkspaceInvitationContext: mocks.workspaceContext,
  createWorkspaceInvitation: mocks.workspaceSend,
  WorkspaceInvitationError: class extends Error {
    status: number
    email?: string
    constructor({ message, status, email }: { message: string; status: number; email?: string }) {
      super(message)
      this.status = status
      this.email = email
    }
  },
}))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  InvitationsNotAllowedError: class extends Error {},
}))

import { sendInvitationBatch } from '@/lib/invitations/application/send-invitation-batch'
import { WorkspaceInvitationError } from '@/lib/invitations/workspace-invitations'

const principal = { kind: 'session', userId: 'admin-user', sessionId: 'session' } as const
const orgInput = {
  workspaceIds: [],
  organizationId: 'org-target',
  emails: ['person@example.com'],
  membership: 'member' as const,
}
const invitation = {
  id: 'invite',
  email: 'person@example.com',
  workspaceIds: [],
  permission: 'read',
  membershipIntent: 'internal',
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  queueTableRows(user, [{ name: 'Current Admin', email: 'admin@example.com' }])
  mocks.orgContext.mockImplementation(async (context) => context)
  mocks.workspaceContext.mockResolvedValue({
    targets: [{ workspaceId: 'workspace' }],
    organizationId: 'org-target',
  })
  mocks.orgSend.mockResolvedValue(invitation)
  mocks.workspaceSend.mockResolvedValue({ ...invitation, workspaceIds: ['workspace'] })
})
afterEach(resetDbChainMock)

describe('invitation batch application boundary', () => {
  it('allows empty workspace grants only for an explicitly scoped internal org invitation', () => {
    expect(batchWorkspaceInvitationBodySchema.safeParse(orgInput).success).toBe(true)
    expect(
      batchWorkspaceInvitationBodySchema.safeParse({ ...orgInput, organizationId: undefined })
        .success
    ).toBe(false)
    expect(
      batchWorkspaceInvitationBodySchema.safeParse({ ...orgInput, membership: 'external' }).success
    ).toBe(false)
    expect(
      batchWorkspaceInvitationBodySchema.safeParse({
        workspaceIds: ['workspace'],
        emails: ['person@example.com'],
      }).success
    ).toBe(true)
  })

  it('rejects workspace API keys before any user or scope lookup', async () => {
    await expect(
      sendInvitationBatch.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'workspace', keyId: 'key' },
        input: orgInput,
      })
    ).rejects.toThrow('principal kind workspace_api_key')
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mocks.orgContext).not.toHaveBeenCalled()
  })

  it('uses current principal identity and org authority without a workspace selection', async () => {
    const result = await sendInvitationBatch.execute({ principal, input: orgInput })
    expect(result).toMatchObject({ success: true, successful: ['person@example.com'], failed: [] })
    expect(mocks.orgContext).toHaveBeenCalledWith({
      organizationId: 'org-target',
      inviterId: 'admin-user',
      inviterName: 'Current Admin',
      inviterEmail: 'admin@example.com',
    })
    expect(mocks.workspaceContext).not.toHaveBeenCalled()
    expect(mocks.orgSend).toHaveBeenCalledWith(expect.objectContaining({ role: 'member' }))
  })

  it('keeps workspace invitations on the existing per-workspace authorization path', async () => {
    await sendInvitationBatch.execute({
      principal,
      input: { ...orgInput, workspaceIds: ['workspace'], permission: 'write' },
    })
    expect(mocks.workspaceContext).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceIds: ['workspace'], inviterId: 'admin-user' })
    )
    expect(mocks.workspaceSend).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'write' })
    )
    expect(mocks.orgSend).not.toHaveBeenCalled()
  })

  it('rejects mismatched asserted org scope after canonical workspace authorization', async () => {
    mocks.workspaceContext.mockResolvedValue({ targets: [], organizationId: 'org-other' })
    await expect(
      sendInvitationBatch.execute({
        principal,
        input: { ...orgInput, workspaceIds: ['workspace'] },
      })
    ).rejects.toThrow('do not belong to this organization')
    expect(mocks.workspaceSend).not.toHaveBeenCalled()
  })

  it('preserves earlier successes and reports later failures without leaking infrastructure details', async () => {
    mocks.orgSend
      .mockResolvedValueOnce(invitation)
      .mockRejectedValueOnce(new Error('postgres private-connection-string'))
    const result = await sendInvitationBatch.execute({
      principal,
      input: { ...orgInput, emails: ['person@example.com', 'other@example.com'] },
    })
    expect(result).toMatchObject({
      success: false,
      successful: ['person@example.com'],
      failed: [
        { email: 'other@example.com', error: 'Failed to create invitation. Please try again.' },
      ],
    })
  })

  it('deduplicates normalized addresses and preserves actionable per-email refusals', async () => {
    mocks.orgSend.mockRejectedValue(
      new WorkspaceInvitationError({
        message: 'No available seats',
        status: 400,
        email: 'person@example.com',
      })
    )
    const result = await sendInvitationBatch.execute({
      principal,
      input: { ...orgInput, emails: ['person@example.com', ' PERSON@example.com '] },
    })
    expect(result.failed).toEqual([
      { email: 'person@example.com', error: 'No available seats' },
      {
        email: 'person@example.com',
        error: 'person@example.com appears more than once in this invitation batch',
      },
    ])
    expect(mocks.orgSend).toHaveBeenCalledTimes(1)
  })

  it('reports directory-managed refusals and continues the workspace invitation batch', async () => {
    const message = 'This person is provisioned by the organization’s identity provider.'
    mocks.workspaceSend.mockRejectedValueOnce(
      new ForbiddenOperationError('SCIM_MANAGED_MEMBERSHIP', message)
    )
    const result = await sendInvitationBatch.execute({
      principal,
      input: {
        ...orgInput,
        workspaceIds: ['workspace'],
        emails: ['managed@example.com', 'person@example.com'],
      },
    })
    expect(result).toMatchObject({
      success: false,
      successful: ['person@example.com'],
      failed: [{ email: 'managed@example.com', error: message }],
    })
    expect(mocks.workspaceSend).toHaveBeenCalledTimes(2)
  })
})
