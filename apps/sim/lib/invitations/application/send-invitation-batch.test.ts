/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { member, user } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { batchWorkspaceInvitationBodySchema } from '@/lib/api/contracts/invitations'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'

const mocks = vi.hoisted(() => ({
  orgContext: vi.fn(),
  workspaceContext: vi.fn(),
  orgSend: vi.fn(),
  workspaceSend: vi.fn(),
  canonicalWorkspace: vi.fn(),
  workspaceRole: vi.fn(),
  config: vi.fn(),
  invitePolicy: vi.fn(),
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.canonicalWorkspace,
}))
vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: mocks.workspaceRole,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))
vi.mock('@/lib/permission-groups/config-scope.server', () => ({
  resolvePermissionGroupConfig: mocks.config,
}))
vi.mock('@/lib/workspaces/policy', () => ({
  getWorkspaceInvitePolicy: mocks.invitePolicy,
}))
vi.mock('@/lib/invitations/organization-invitations', () => ({
  prepareOrganizationInvitationContext: mocks.orgContext,
}))
vi.mock('@/lib/organizations/application/invitations', () => ({
  createOrganizationInvitation: { execute: mocks.orgSend },
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

import { SIM_CLI_CLIENT_ID } from '@/lib/auth/oauth-provider'
import {
  sendInvitationBatch,
  sendOrganizationInvitationBatch,
  sendWorkspaceInvitationBatch,
} from '@/lib/invitations/application/send-invitation-batch'
import {
  type createWorkspaceInvitation,
  WorkspaceInvitationError,
} from '@/lib/invitations/workspace-invitations'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const principal = { kind: 'session', userId: 'admin-user', sessionId: 'session' } as const
const personal = { kind: 'personal_api_key', userId: 'admin-user', keyId: 'key' } as const
const oauth = {
  kind: 'oauth_access_token',
  userId: 'admin-user',
  clientId: 'client',
  tokenId: 'token',
  scopes: ['api:read', 'api:write'],
  expiresAt: new Date('2099-01-01'),
} as const
const canonicalWorkspace = {
  workspaceId: 'workspace',
  workspaceOrganizationId: 'org-target',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'other-user',
}
const lockedWorkspace = {
  id: 'workspace',
  name: 'Workspace',
  ownerId: 'other-user',
  organizationId: 'org-target',
  workspaceMode: 'organization' as const,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'other-user',
}
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
  mocks.canonicalWorkspace.mockResolvedValue(canonicalWorkspace)
  mocks.workspaceRole.mockResolvedValue('admin')
  mocks.config.mockResolvedValue(null)
  mocks.invitePolicy.mockResolvedValue({
    allowed: true,
    requiresSeat: false,
    reason: null,
    organizationId: 'org-target',
    upgradeRequired: false,
  })
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
    ).rejects.toMatchObject({ detailCode: 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED' })
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
    expect(mocks.orgSend).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        input: { organizationId: 'org-target', email: 'person@example.com', role: 'member' },
      })
    )
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
    expect(mocks.canonicalWorkspace).not.toHaveBeenCalled()
  })

  it.each([personal, oauth])(
    'authorizes the actual $kind caller and carries audit identity',
    async (principal) => {
      await sendInvitationBatch.execute({
        principal,
        input: { workspaceIds: ['workspace'], emails: ['person@example.com'] },
      })
      expect(mocks.workspaceRole).toHaveBeenCalledWith(
        'admin-user',
        'workspace',
        'org-target',
        db,
        { forUpdate: undefined }
      )
      expect(mocks.config).toHaveBeenCalledWith('admin-user', 'workspace', 'org-target', db)
      expect(mocks.workspaceContext).toHaveBeenCalledWith(
        expect.objectContaining({
          inviterId: 'admin-user',
          auditActor: expect.objectContaining({
            id: 'admin-user',
            metadata: {
              actor: expect.objectContaining({ kind: principal.kind, userId: 'admin-user' }),
              operation: 'invitations.send_batch',
            },
          }),
        })
      )
    }
  )

  it('rejects read-only OAuth before any protected lookup', async () => {
    await expect(
      sendInvitationBatch.execute({
        principal: { ...oauth, scopes: ['api:read'] },
        input: { workspaceIds: ['workspace'], emails: ['person@example.com'] },
      })
    ).rejects.toMatchObject({ detailCode: 'INSUFFICIENT_SCOPE' })
    expect(mocks.canonicalWorkspace).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it.each([null, 'write', 'read'])(
    'refuses workspace role %s before invitation preparation',
    async (role) => {
      mocks.workspaceRole.mockResolvedValue(role)
      await expect(
        sendInvitationBatch.execute({
          principal: personal,
          input: { workspaceIds: ['workspace'], emails: ['person@example.com'] },
        })
      ).rejects.toThrow()
      expect(mocks.workspaceContext).not.toHaveBeenCalled()
      expect(mocks.workspaceSend).not.toHaveBeenCalled()
    }
  )

  it.each([
    [personal, { disablePersonalApiKeys: true }],
    [oauth, { disableOAuthAppAccess: true }],
    [{ ...oauth, clientId: SIM_CLI_CLIENT_ID }, { disableCliAccess: true }],
  ] as const)(
    'enforces credential policy before preparing a workspace invitation',
    async (principal, restriction) => {
      mocks.config.mockResolvedValue({ ...DEFAULT_PERMISSION_GROUP_CONFIG, ...restriction })
      await expect(
        sendInvitationBatch.execute({
          principal,
          input: { workspaceIds: ['workspace'], emails: ['person@example.com'] },
        })
      ).rejects.toThrow()
      expect(mocks.workspaceContext).not.toHaveBeenCalled()
      expect(mocks.workspaceSend).not.toHaveBeenCalled()
    }
  )

  it('refuses a workspace that disabled personal keys before invitation preparation', async () => {
    mocks.canonicalWorkspace.mockResolvedValue({
      ...canonicalWorkspace,
      allowPersonalApiKeys: false,
    })
    await expect(
      sendInvitationBatch.execute({
        principal: personal,
        input: { workspaceIds: ['workspace'], emails: ['person@example.com'] },
      })
    ).rejects.toMatchObject({ detailCode: 'PERSONAL_API_KEYS_DISABLED' })
    expect(mocks.workspaceContext).not.toHaveBeenCalled()
  })

  it('preserves the first recipient when workspace credential policy changes before the next', async () => {
    mocks.workspaceSend.mockImplementationOnce(async () => {
      mocks.canonicalWorkspace.mockResolvedValue({
        ...canonicalWorkspace,
        allowPersonalApiKeys: false,
      })
      return { ...invitation, workspaceIds: ['workspace'] }
    })
    const result = await sendInvitationBatch.execute({
      principal: personal,
      input: { workspaceIds: ['workspace'], emails: ['person@example.com', 'other@example.com'] },
    })
    expect(result).toMatchObject({
      success: false,
      successful: ['person@example.com'],
      failed: [
        {
          email: 'other@example.com',
          error: 'Personal API keys are not allowed for this workspace',
        },
      ],
    })
    expect(mocks.workspaceSend).toHaveBeenCalledTimes(1)
  })

  it('stops later recipients when permission-group invitation access is withdrawn', async () => {
    mocks.workspaceSend.mockImplementationOnce(async () => {
      mocks.config.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        disableInvitations: true,
      })
      return { ...invitation, workspaceIds: ['workspace'] }
    })
    const result = await sendInvitationBatch.execute({
      principal: personal,
      input: { workspaceIds: ['workspace'], emails: ['person@example.com', 'other@example.com'] },
    })
    expect(result).toMatchObject({
      success: false,
      successful: ['person@example.com'],
      failed: [{ email: 'other@example.com', error: expect.stringMatching(/invitation/i) }],
    })
    expect(mocks.workspaceSend).toHaveBeenCalledTimes(1)
    expect(mocks.config).toHaveBeenLastCalledWith('admin-user', 'workspace', 'org-target', db)
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

  it.each([
    [personal, { disableInvitations: true }],
    [oauth, { disableInvitations: true }],
    [personal, { disablePersonalApiKeys: true }],
    [oauth, { disableOAuthAppAccess: true }],
    [{ ...oauth, clientId: SIM_CLI_CLIENT_ID }, { disableCliAccess: true }],
  ] as const)(
    'rechecks $0.kind admission using the locked transaction after allowed preflight',
    async (principal, restriction) => {
      const tx = new Proxy(db, {})
      const write = vi.fn()
      mocks.workspaceSend.mockImplementationOnce(
        async (input: Parameters<typeof createWorkspaceInvitation>[0]) => {
          mocks.config.mockImplementation(async (_user, _workspace, _organization, executor) =>
            executor === tx ? { ...DEFAULT_PERMISSION_GROUP_CONFIG, ...restriction } : null
          )
          expect(input.validateLockedWorkspace).toBeTypeOf('function')
          await input.validateLockedWorkspace?.(tx, lockedWorkspace)
          write()
          return invitation
        }
      )
      const result = await sendInvitationBatch.execute({
        principal,
        input: { workspaceIds: ['workspace'], emails: ['person@example.com'] },
      })
      expect(result).toMatchObject({
        success: false,
        successful: [],
        added: [],
        invitations: [],
        failed: [{ email: 'person@example.com', error: expect.any(String) }],
      })
      expect(write).not.toHaveBeenCalled()
      expect(mocks.workspaceRole).toHaveBeenLastCalledWith(
        'admin-user',
        'workspace',
        'org-target',
        tx,
        { forUpdate: true }
      )
      expect(mocks.config).toHaveBeenLastCalledWith('admin-user', 'workspace', 'org-target', tx)
    }
  )

  it.each([
    [{ ...lockedWorkspace, allowPersonalApiKeys: false }, 'Personal API keys are not allowed'],
    [{ ...lockedWorkspace, organizationId: 'moved-org' }, 'changed organizations'],
  ])(
    'uses the locked workspace policy and original organization scope',
    async (workspace, error) => {
      const write = vi.fn()
      mocks.workspaceSend.mockImplementationOnce(
        async (input: Parameters<typeof createWorkspaceInvitation>[0]) => {
          expect(input.validateLockedWorkspace).toBeTypeOf('function')
          await input.validateLockedWorkspace?.(db, workspace)
          write()
          return invitation
        }
      )
      const result = await sendInvitationBatch.execute({
        principal: personal,
        input: { workspaceIds: ['workspace'], emails: ['person@example.com'] },
      })
      expect(result.success).toBe(false)
      expect(result.failed[0].error).toContain(error)
      expect(write).not.toHaveBeenCalled()
    }
  )

  it('leaves session invitation admission on the existing path', async () => {
    await sendInvitationBatch.execute({
      principal,
      input: { workspaceIds: ['workspace'], emails: ['person@example.com'] },
    })
    expect(mocks.workspaceSend).toHaveBeenCalledWith(
      expect.objectContaining({ validateLockedWorkspace: undefined })
    )
  })

  it('refuses a plan disabled after preflight using the locked billing context', async () => {
    const tx = new Proxy(db, {})
    const write = vi.fn()
    mocks.invitePolicy.mockResolvedValueOnce({
      allowed: false,
      requiresSeat: false,
      reason: 'Upgrade to invite teammates',
      organizationId: 'org-target',
      upgradeRequired: true,
    })
    mocks.workspaceSend.mockImplementationOnce(
      async (input: Parameters<typeof createWorkspaceInvitation>[0]) => {
        expect(input.validateLockedWorkspace).toBeTypeOf('function')
        await input.validateLockedWorkspace?.(tx, lockedWorkspace)
        write()
        return invitation
      }
    )
    const result = await sendInvitationBatch.execute({
      principal: personal,
      input: { workspaceIds: ['workspace'], emails: ['person@example.com'] },
    })
    expect(result).toMatchObject({
      success: false,
      failed: [{ email: 'person@example.com', error: 'Upgrade to invite teammates' }],
    })
    expect(mocks.invitePolicy).toHaveBeenCalledExactlyOnceWith(lockedWorkspace, tx)
    expect(write).not.toHaveBeenCalled()
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

  it.each([
    new WorkspaceInvitationError({ message: 'Private delivery provider failure', status: 502 }),
    new Error('Private persistence failure after a grant'),
  ])(
    'does not expose public delivery infrastructure details or advise a blind retry',
    async (error) => {
      mocks.workspaceSend.mockRejectedValue(error)
      const result = await sendInvitationBatch.execute({
        principal: personal,
        input: { workspaceIds: ['workspace'], emails: ['person@example.com'] },
      })
      expect(result.success).toBe(false)
      expect(result.failed[0].error).toMatch(
        'Check workspace members and invitations before retrying.'
      )
      expect(result.failed[0].error).not.toContain('Private')
      expect(result.invitations).toEqual([])
    }
  )

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

const delegated = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  subjectUserId: 'admin-user',
  organizationId: 'org-target',
  delegationId: 'invites',
  audience: 'sim:settings',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { chatId: 'chat' },
} as const

describe('organization invitation delegation', () => {
  it.each(['admin', 'owner'])(
    'uses current %s authority and actual actor in existing delivery pipeline',
    async (role) => {
      queueTableRows(member, [{ role }])
      await expect(
        sendOrganizationInvitationBatch.execute({ principal: delegated, input: orgInput })
      ).resolves.toMatchObject({ success: true })
      expect(mocks.orgContext).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-target', inviterId: 'admin-user' })
      )
      expect(mocks.orgSend).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          principal: delegated,
          input: { organizationId: 'org-target', email: 'person@example.com', role: 'member' },
        })
      )
    }
  )
  it.each([{ role: 'member' }, { role: null }])(
    'refuses revoked or insufficient role before delivery',
    async ({ role }) => {
      queueTableRows(member, role ? [{ role }] : [])
      await expect(
        sendOrganizationInvitationBatch.execute({ principal: delegated, input: orgInput })
      ).rejects.toThrow()
      expect(mocks.orgContext).not.toHaveBeenCalled()
      expect(mocks.orgSend).not.toHaveBeenCalled()
    }
  )
  it.each([
    { organizationId: 'foreign' },
    { audience: 'sim:knowledge' },
    { expiresAt: new Date(0) },
  ])('rejects invalid delegation', async (change) => {
    await expect(
      sendOrganizationInvitationBatch.execute({
        principal: { ...delegated, ...change },
        input: orgInput,
      })
    ).rejects.toThrow()
    expect(mocks.orgSend).not.toHaveBeenCalled()
  })
  it('does not let organization authority grant workspace access', async () => {
    await expect(
      sendOrganizationInvitationBatch.execute({
        principal: delegated,
        input: { ...orgInput, workspaceIds: ['foreign-workspace'] },
      })
    ).rejects.toThrow('cannot grant workspace access')
    expect(mocks.workspaceContext).not.toHaveBeenCalled()
    expect(mocks.workspaceSend).not.toHaveBeenCalled()
  })
})

it('enforces invitation capability on delegated admins before sending', async () => {
  queueTableRows(member, [{ role: 'admin' }])
  mocks.config.mockResolvedValue({ disableInvitations: true })
  await expect(
    sendOrganizationInvitationBatch.execute({ principal: delegated, input: orgInput })
  ).rejects.toThrow()
  expect(mocks.orgSend).not.toHaveBeenCalled()
})

describe('workspace invitation delegation', () => {
  const actor = {
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: 'admin-user',
    workspaceId: 'workspace',
    delegationId: 'workspace-invites',
    audience: 'sim:settings',
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  } as const
  const input = { ...orgInput, workspaceIds: ['workspace'] }

  it('preserves the current actor in the workspace delivery lifecycle', async () => {
    await expect(
      sendWorkspaceInvitationBatch.execute({ principal: actor, input })
    ).resolves.toMatchObject({ success: true })
    expect(mocks.workspaceContext).toHaveBeenCalledWith(
      expect.objectContaining({
        inviterId: 'admin-user',
        workspaceIds: ['workspace'],
        auditActor: expect.objectContaining({
          id: 'admin-user',
          metadata: expect.objectContaining({
            actor: expect.objectContaining({ kind: 'delegated' }),
          }),
        }),
      })
    )
  })

  it.each([[], ['foreign'], ['workspace', 'foreign']])(
    'rejects targets outside the delegated workspace: %j',
    async (workspaceIds) => {
      await expect(
        sendWorkspaceInvitationBatch.execute({
          principal: actor,
          input: { ...input, workspaceIds },
        })
      ).rejects.toThrow()
      expect(mocks.workspaceContext).not.toHaveBeenCalled()
      expect(mocks.workspaceSend).not.toHaveBeenCalled()
    }
  )

  it.each([{ audience: 'sim:knowledge' }, { expiresAt: new Date(0) }, { serviceId: 'untrusted' }])(
    'rejects invalid workspace grants before delivery: %j',
    async (patch) => {
      await expect(
        sendWorkspaceInvitationBatch.execute({ principal: { ...actor, ...patch }, input })
      ).rejects.toThrow()
      expect(mocks.workspaceSend).not.toHaveBeenCalled()
    }
  )

  it('rechecks current admin authority before delivery', async () => {
    mocks.workspaceRole.mockResolvedValue('write')
    await expect(
      sendWorkspaceInvitationBatch.execute({ principal: actor, input })
    ).rejects.toThrow()
    expect(mocks.workspaceSend).not.toHaveBeenCalled()
  })
})
