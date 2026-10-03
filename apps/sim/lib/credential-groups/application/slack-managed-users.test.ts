import { credentialGroup } from '@sim/db/schema'
import { auditMock, queueTableRows, resetDbChainMock } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  credentialGroupsAvailabilityMock,
  credentialGroupsAvailabilityMockFns,
} from '@sim/testing/mocks/credential-groups-availability.mock'
import { credentialGroupsOrganizationSetupMock } from '@sim/testing/mocks/credential-groups-organization-setup.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import {
  workspaceAuthorizationMock,
  workspaceAuthorizationMockFns,
} from '@sim/testing/mocks/workspace-authorization.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  create: vi.fn(),
  load: vi.fn(),
  consume: vi.fn(),
  exchange: vi.fn(),
}))
vi.mock('@/lib/credential-groups/organization-setup', () => credentialGroupsOrganizationSetupMock)

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)
vi.mock('@/lib/credential-groups/slack-managed-users', () => ({
  createSlackManagedUsersAttempt: hoisted.create,
  loadSlackManagedUsersAttempt: hoisted.load,
  consumeSlackManagedUsersAttempt: hoisted.consume,
  exchangeAndConfigureSlackManagedUsers: hoisted.exchange,
}))

import {
  completeSlackCredentialGroupConfiguration,
  startSlackCredentialGroupConfiguration,
} from '@/lib/credential-groups/application/slack-managed-users'

const mocks = {
  ...hoisted,
  workspaceAccess: workspaceAuthorizationMockFns.mockAuthorizeWorkspaceOperation,
  available: credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable,
}

const organizationAccess = organizationAuthorizationMockFns.mockRequireOrganizationMembership
const workspaceContext = workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext
const principal = createSessionPrincipal()
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
  resetDbChainMock()
  mocks.available.mockResolvedValue(true)
  organizationAccess.mockResolvedValue({
    organizationId: 'organization-1',
    userId: 'user-1',
    role: 'admin',
  })
  mocks.workspaceAccess.mockResolvedValue(undefined)
  workspaceContext.mockResolvedValue({ workspaceId: 'workspace-1' })
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
    expect(organizationAccess).toHaveBeenCalledWith(principal, 'organization-1', 'admin', 'none')
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
    expect(organizationAccess).not.toHaveBeenCalled()
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
    organizationAccess.mockRejectedValue(new Error('Role revoked'))
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
