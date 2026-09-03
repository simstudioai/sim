/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/credential-groups/enrollments', () => ({
  createCredentialGroupInvitationLink: vi.fn(),
  inviteCredentialGroupEnrollment: vi.fn(),
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: vi.fn(),
}))
vi.mock('@/lib/knowledge/connectors/member-queue', () => ({ dispatchMemberSync: vi.fn() }))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveSystemBillingAttribution: vi.fn(),
}))
vi.mock('@/lib/credential-groups/service', () => ({
  createCredentialGroup: vi.fn(),
  listCredentialGroups: vi.fn(),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ getUsersWithPermissions: vi.fn() }))

import { createCredentialGroup, listCredentialGroups } from '@/lib/credential-groups/service'
import {
  chooseSharedMembersBinding,
  deriveViewerConnectorMembership,
  pickProvisionedGroupName,
  provisionKnowledgeConnectorMembersBinding,
} from '@/lib/knowledge/connectors/member-provisioning'

describe('provisionKnowledgeConnectorMembersBinding', () => {
  const slackMeta = { name: 'Slack', auth: { mode: 'oauth' as const, provider: 'slack' } }
  const gmailMeta = { name: 'Gmail', auth: { mode: 'oauth' as const, provider: 'google-email' } }
  const slackOption = (id: string, configurationStatus = 'ready') => ({
    id,
    provider: 'slack',
    label: 'Slack',
    required: true,
    status: 'active',
    slackBotCredentialId: 'cred-bot',
    configurationStatus,
  })
  const group = (id: string, options: unknown[]) => ({ id, name: id, status: 'active', options })
  const provision = (meta: typeof slackMeta) =>
    provisionKnowledgeConnectorMembersBinding({
      workspaceId: 'ws-1',
      connectorMeta: meta,
      userId: 'user-1',
    })

  beforeEach(() => {
    vi.mocked(listCredentialGroups).mockReset()
    vi.mocked(createCredentialGroup).mockReset()
  })

  it('adopts the one Slack option an admin has already set up', async () => {
    vi.mocked(listCredentialGroups).mockResolvedValue([group('g-1', [slackOption('o-1')])] as never)

    await expect(provision(slackMeta)).resolves.toEqual({
      credentialGroupId: 'g-1',
      credentialGroupOptionId: 'o-1',
    })
    expect(createCredentialGroup).not.toHaveBeenCalled()
  })

  it('points at Settings when no ready Slack option exists, since it cannot create one', async () => {
    vi.mocked(listCredentialGroups).mockResolvedValue([
      group('g-1', [slackOption('o-1', 'not_configured')]),
    ] as never)

    await expect(provision(slackMeta)).rejects.toThrow('in Settings')
    expect(createCredentialGroup).not.toHaveBeenCalled()
  })

  it('leaves two Slack options for the admin to choose between', async () => {
    vi.mocked(listCredentialGroups).mockResolvedValue([
      group('g-1', [slackOption('o-1')]),
      group('g-2', [slackOption('o-2')]),
    ] as never)

    await expect(provision(slackMeta)).rejects.toThrow('choose which one')
  })

  it('still creates a group for a standard OAuth provider', async () => {
    vi.mocked(listCredentialGroups).mockResolvedValue([])
    vi.mocked(createCredentialGroup).mockResolvedValue({
      id: 'g-new',
      options: [{ id: 'o-new' }],
    } as never)

    await expect(provision(gmailMeta)).resolves.toEqual({
      credentialGroupId: 'g-new',
      credentialGroupOptionId: 'o-new',
    })
    expect(createCredentialGroup).toHaveBeenCalledWith('ws-1', 'user-1', {
      name: 'Gmail',
      options: [{ provider: 'gmail', label: 'Gmail', required: true }],
    })
  })
})

describe('pickProvisionedGroupName', () => {
  it('names the group after the connector and steps past taken names', () => {
    expect(pickProvisionedGroupName('Google Drive', [])).toBe('Google Drive')
    expect(pickProvisionedGroupName('Google Drive', ['google drive'])).toBe('Google Drive 2')
    expect(pickProvisionedGroupName('Google Drive', ['Google Drive', 'Google Drive 2'])).toBe(
      'Google Drive 3'
    )
  })

  it('gives up with a pointer to Settings once every candidate is taken', () => {
    const taken = [
      'Google Drive',
      'Google Drive 2',
      'Google Drive 3',
      'Google Drive 4',
      'Google Drive 5',
    ]
    expect(() => pickProvisionedGroupName('Google Drive', taken)).toThrow('Settings')
  })
})

describe('chooseSharedMembersBinding', () => {
  const a = { credentialGroupId: 'g1', credentialGroupOptionId: 'o1' }
  const b = { credentialGroupId: 'g2', credentialGroupOptionId: 'o2' }

  it('reuses the option other members-mode connectors sync through', () => {
    expect(chooseSharedMembersBinding([a, b], new Set(['o2']))).toBe(b)
  })

  it('creates a new group rather than repurpose one nobody syncs through', () => {
    expect(chooseSharedMembersBinding([a, b], new Set())).toBeUndefined()
    expect(chooseSharedMembersBinding([], new Set())).toBeUndefined()
  })

  it('leaves two shared options for the caller to choose between', () => {
    expect(chooseSharedMembersBinding([a, b], new Set(['o1', 'o2']))).toBeNull()
  })
})

describe('deriveViewerConnectorMembership', () => {
  it.each([
    [true, 'active', 'completed', 'connected'],
    [true, 'active', 'in_progress', 'connected'],
    [true, 'needs_reauth', 'completed', 'needs_reauth'],
    [true, null, 'invited', 'invited'],
    [true, null, 'delivery_failed', 'invited'],
    [true, null, 'in_progress', 'invited'],
    [true, null, 'completed', 'invited'],
    [true, 'revoked', 'completed', 'invited'],
    [true, 'active', 'revoked', 'revoked'],
    [true, null, 'revoked', 'revoked'],
    [true, null, null, 'not_enrolled'],
    [false, 'active', 'completed', 'unverified_email'],
  ] as const)(
    'verified %s + credential %s + enrollment %s → %s',
    (emailVerified, managedOauthStatus, enrollmentStatus, expected) => {
      expect(
        deriveViewerConnectorMembership({ emailVerified, managedOauthStatus, enrollmentStatus })
      ).toBe(expected)
    }
  )
})
