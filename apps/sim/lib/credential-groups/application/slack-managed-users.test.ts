/**
 * @vitest-environment node
 */
import { credentialGroup } from '@sim/db/schema'
import { auditMock, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  organizationAccess: vi.fn(),
  workspaceAccess: vi.fn(),
  workspaceContext: vi.fn(),
  available: vi.fn(),
  create: vi.fn(),
  load: vi.fn(),
  consume: vi.fn(),
  exchange: vi.fn(),
}))
vi.mock('@/lib/credential-groups/organization-setup', () => ({
  requireOrganizationAccountsSetup: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/core/application/organization-authorization', () => ({
  requireOrganizationMembership: mocks.organizationAccess,
}))
vi.mock('@/lib/core/application/workspace-authorization', () => ({
  authorizeWorkspaceOperation: mocks.workspaceAccess,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.workspaceContext,
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: mocks.available,
}))
vi.mock('@/lib/credential-groups/slack-managed-users', () => ({
  createSlackManagedUsersAttempt: mocks.create,
  loadSlackManagedUsersAttempt: mocks.load,
  consumeSlackManagedUsersAttempt: mocks.consume,
  exchangeAndConfigureSlackManagedUsers: mocks.exchange,
}))

import {
  completeSlackCredentialGroupConfiguration,
  startSlackCredentialGroupConfiguration,
} from '@/lib/credential-groups/application/slack-managed-users'

const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const group = { id: 'group-1', workspaceId: null, organizationId: 'organization-1' }
const attempt = {
  organizationId: 'organization-1',
  userId: 'user-1',
  credentialGroupId: 'group-1',
  credentialGroupUpdatedAt: 1,
  slackBotCredentialId: 'bot-1',
  slackBotCredentialUpdatedAt: 2,
  expectedAppId: 'app-1',
  expectedTeamId: 'team-1',
  clientId: 'client-1',
  clientSecret: 'test-secret',
  redirectUri: 'https://sim.test/callback',
  requiredScopes: ['search:read'],
  createdAt: 3,
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.available.mockResolvedValue(true)
  mocks.organizationAccess.mockResolvedValue({
    organizationId: 'organization-1',
    userId: 'user-1',
    role: 'admin',
  })
  mocks.workspaceAccess.mockResolvedValue(undefined)
  mocks.workspaceContext.mockResolvedValue({ workspaceId: 'workspace-1' })
  mocks.create.mockResolvedValue({ state: 'state-1', authorizationUrl: 'https://slack.com/oauth' })
  mocks.load.mockResolvedValue(attempt)
  mocks.consume.mockResolvedValue(attempt)
  mocks.exchange.mockResolvedValue({
    credentialGroupId: 'group-1',
    credentialGroupName: 'Connected accounts',
    slackBotCredentialId: 'bot-1',
    appId: 'app-1',
    teamId: 'team-1',
    requiredScopes: ['search:read'],
  })
})

const start = (owner = { organizationId: 'organization-1' }) =>
  startSlackCredentialGroupConfiguration.execute({
    principal,
    input: {
      ...owner,
      credentialGroupId: 'group-1',
      slackBotCredentialId: 'bot-1',
      clientId: 'client-1',
      clientSecret: 'test-secret',
    },
  })
const finish = () =>
  completeSlackCredentialGroupConfiguration.execute({
    principal,
    input: { state: 'state-1', code: 'code-1' },
  })

describe('scoped Slack setup', () => {
  it('creates an organization-bound attempt after current admin and feature checks', async () => {
    queueTableRows(credentialGroup, [group])
    await start()
    expect(mocks.organizationAccess).toHaveBeenCalledWith(
      principal,
      'organization-1',
      'admin',
      'none'
    )
    expect(mocks.available).toHaveBeenCalledWith({
      kind: 'organization',
      organizationId: 'organization-1',
    })
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'organization-1', userId: 'user-1' })
    )
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('workspaceId')
    expect(mocks.workspaceAccess).not.toHaveBeenCalled()
  })

  it.each([
    { ...group, organizationId: 'another-org' },
    { ...group, workspaceId: 'organization-1', organizationId: null },
  ])('rejects a group in a different canonical scope', async (foreignGroup) => {
    queueTableRows(credentialGroup, [foreignGroup])
    await expect(start()).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('preserves workspace authorization for workspace setup', async () => {
    queueTableRows(credentialGroup, [
      { ...group, workspaceId: 'workspace-1', organizationId: null },
    ])
    await startSlackCredentialGroupConfiguration.execute({
      principal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
        slackBotCredentialId: 'bot-1',
        clientId: 'client-1',
        clientSecret: 'test-secret',
      },
    })
    expect(mocks.workspaceAccess).toHaveBeenCalled()
    expect(mocks.organizationAccess).not.toHaveBeenCalled()
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ workspaceId: 'workspace-1' })
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('organizationId')
  })

  it('requires the initiating user before consuming an authorization attempt', async () => {
    mocks.load.mockResolvedValue({ ...attempt, userId: 'someone-else' })
    await expect(finish()).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.consume).not.toHaveBeenCalled()
    expect(mocks.exchange).not.toHaveBeenCalled()
  })

  it('rechecks admin access before consuming the callback', async () => {
    queueTableRows(credentialGroup, [group])
    mocks.organizationAccess.mockRejectedValue(new Error('Role revoked'))
    await expect(finish()).rejects.toThrow('Role revoked')
    expect(mocks.consume).not.toHaveBeenCalled()
    expect(mocks.exchange).not.toHaveBeenCalled()
  })

  it.each([
    { organizationId: 'another-org' },
    { credentialGroupUpdatedAt: 9 },
    { slackBotCredentialUpdatedAt: 9 },
    { expectedAppId: 'another-app' },
  ])('rejects changed one-time state before provider exchange', async (change) => {
    queueTableRows(credentialGroup, [group])
    mocks.consume.mockResolvedValue({ ...attempt, ...change })
    await expect(finish()).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.exchange).not.toHaveBeenCalled()
  })

  it('finishes an organization attempt and audits the actual actor and owner', async () => {
    queueTableRows(credentialGroup, [group])
    await expect(finish()).resolves.toMatchObject({ ok: true })
    expect(mocks.exchange).toHaveBeenCalledWith({ attempt, code: 'code-1' })
    expect(auditMock.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        metadata: expect.objectContaining({ organizationId: 'organization-1' }),
      })
    )
  })
})
