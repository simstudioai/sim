/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorizeOperation: vi.fn(),
  authorize: vi.fn(),
  ownAccount: vi.fn(),
  listAccounts: vi.fn(),
  completion: vi.fn(),
  provision: vi.fn(),
  enrollment: vi.fn(),
  oauthContext: vi.fn(),
  oauth: vi.fn(),
  selector: vi.fn(),
  configure: vi.fn(),
  binding: vi.fn(),
  group: vi.fn(),
  dispatch: vi.fn(),
  billing: vi.fn(),
}))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.authorizeOperation,
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOrganizationContext: async ({ organizationId }: { organizationId: string }) => ({
    organizationId,
    workspaceId: undefined,
  }),
}))
vi.mock('@/lib/knowledge/application/personal-search-account', () => ({
  authorizePersonalSearchSetup: mocks.authorize,
  authorizePersonalSearchSetupCredential: mocks.ownAccount,
}))
vi.mock('@/lib/credentials/organization-managed', () => ({
  getOwnOrganizationManagedOAuthCredentials: mocks.listAccounts,
}))
vi.mock('@/lib/credential-groups/search-connection-completion', () => ({
  readSearchConnectionCompletion: mocks.completion,
}))
vi.mock('@/lib/knowledge/connectors/member-provisioning', () => ({
  provisionKnowledgeConnectorMembersBinding: mocks.provision,
}))
vi.mock('@/lib/credential-groups/self-enrollment', () => ({
  createViewerCredentialGroupEnrollment: mocks.enrollment,
}))
vi.mock('@/lib/credential-groups/enrollments', () => ({
  getCredentialGroupOAuthContextForEnrollment: mocks.oauthContext,
}))
vi.mock('@/lib/credential-groups/oauth', () => ({ startCredentialGroupOAuth: mocks.oauth }))
vi.mock('@/lib/selectors/application/execute-selector', () => ({
  executeSelector: { execute: mocks.selector },
}))
vi.mock('@/lib/knowledge/application/sim-search', () => ({
  configureSimSearchConnector: { execute: mocks.configure },
}))
vi.mock('@/lib/credential-groups/credentials', () => ({
  loadManagedCredentialGroupBinding: mocks.binding,
  loadScopedAccountsCredentialListContext: mocks.group,
}))
vi.mock('@/lib/knowledge/connectors/member-queue', () => ({ dispatchMemberSync: mocks.dispatch }))
vi.mock('@/lib/knowledge/application/billing', () => ({
  resolveKnowledgeBillingAttribution: mocks.billing,
}))
vi.mock('@/connectors/registry', () => ({
  CONNECTOR_META_REGISTRY: { jira: { name: 'Jira' }, confluence: { name: 'Confluence' } },
}))

import {
  listPersonalSourceSetupAccounts,
  personalSourceSetup,
} from '@/lib/knowledge/application/personal-source-setup'

const principal = { kind: 'session', userId: 'member-1', sessionId: 'session-1' } as const
const owner = { organizationId: 'organization-1', connectorType: 'jira' } as const
const credential = { credentialId: 'own-account', domain: 'example.atlassian.net' }
const connect = { ...owner, ...credential, action: 'connect', keys: ['PROJECT'] } as const
const account = {
  id: 'own-account',
  displayName: 'Work account',
  providerId: 'jira',
  scopes: ['read:jira-work'],
}
const runConnect = (changes = {}) =>
  personalSourceSetup.execute({ principal, input: { ...connect, keys: ['PROJECT'], ...changes } })

describe('personal source setup', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.authorize.mockResolvedValue(principal.userId)
    mocks.ownAccount.mockResolvedValue(account)
    mocks.listAccounts.mockResolvedValue([account])
    mocks.completion.mockResolvedValue(account.id)
    mocks.provision.mockResolvedValue({
      credentialGroupId: 'group-1',
      credentialGroupOptionId: 'option-1',
    })
    mocks.enrollment.mockResolvedValue({
      enrollment: { id: 'enrollment-1', email: 'member@example.com' },
      invitationLink: 'https://example.com/credential-groups/enroll/invitation-token',
    })
    mocks.oauthContext.mockResolvedValue({ option: { id: 'option-1' } })
    mocks.oauth.mockResolvedValue('https://auth.atlassian.com/authorize')
    mocks.selector.mockResolvedValue({ kind: 'list', items: [{ id: 'PROJECT', label: 'Project' }] })
    mocks.configure.mockResolvedValue({ knowledgeBaseId: 'kb-1', connectorId: 'source-1' })
    mocks.binding.mockResolvedValue({
      organizationId: owner.organizationId,
      credentialGroupId: 'group-1',
      credentialGroupOptionId: 'option-1',
    })
    mocks.group.mockResolvedValue({ credentialGroupId: 'group-1' })
    mocks.billing.mockResolvedValue({ actorUserId: principal.userId })
    mocks.dispatch.mockResolvedValue({ queued: true })
  })

  it('lists owned accounts before a source exists and scopes completion receipts to the viewer', async () => {
    const result = await listPersonalSourceSetupAccounts.execute({
      principal,
      input: { ...owner, completionId: 'completion-1' },
    })
    expect(result).toEqual({
      accounts: [
        {
          id: 'own-account',
          name: 'Work account',
          provider: 'jira',
          type: 'managed_oauth',
          scopes: ['read:jira-work'],
        },
      ],
      completedCredentialId: 'own-account',
    })
    expect(mocks.completion).toHaveBeenCalledWith({
      organizationId: owner.organizationId,
      userId: principal.userId,
      completionId: 'completion-1',
    })
    expect(mocks.configure).not.toHaveBeenCalled()
  })

  it('does not return a receipt for a foreign or no longer active credential', async () => {
    mocks.completion.mockResolvedValue('another-account')
    expect(
      (
        await listPersonalSourceSetupAccounts.execute({
          principal,
          input: { ...owner, completionId: 'completion-1' },
        })
      ).completedCredentialId
    ).toBeNull()
  })

  it('starts verified personal enrollment without creating an index or requiring project keys', async () => {
    const result = await personalSourceSetup.execute({
      principal,
      input: { ...owner, action: 'authorize', oauthCompletionId: 'completion-1' },
    })
    expect(result).toEqual({ kind: 'authorization', url: 'https://auth.atlassian.com/authorize' })
    expect(mocks.enrollment).toHaveBeenCalledWith({
      organizationId: owner.organizationId,
      userId: principal.userId,
      credentialGroupId: 'group-1',
    })
    expect(mocks.oauth).toHaveBeenCalledWith({ option: { id: 'option-1' } }, 'invitation-token', {
      completionRedirect: true,
      returnTo: 'search',
      completionId: 'completion-1',
      connectionIntent: { kind: 'create' },
    })
    expect(mocks.configure).not.toHaveBeenCalled()
    expect(mocks.selector).not.toHaveBeenCalled()
  })

  it('does not start OAuth if enrollment was revoked', async () => {
    mocks.enrollment.mockRejectedValue(new Error('An admin removed your access'))
    await expect(
      personalSourceSetup.execute({
        principal,
        input: { ...owner, action: 'authorize', oauthCompletionId: 'completion-1' },
      })
    ).rejects.toThrow('admin removed')
    expect(mocks.oauth).not.toHaveBeenCalled()
  })

  it.each(['jira', 'confluence'] as const)(
    'dispatches %s discovery through its fixed shared selector',
    async (connectorType) => {
      await personalSourceSetup.execute({
        principal,
        input: {
          ...owner,
          ...credential,
          connectorType,
          action: 'options',
          request: { kind: 'list', cursor: 'page-2' },
        },
      })
      expect(mocks.selector).toHaveBeenCalledWith({
        principal,
        request: undefined,
        input: {
          selectorKey: connectorType === 'jira' ? 'jira.projectKeys' : 'confluence.spaces',
          scope: { kind: 'organization', organizationId: owner.organizationId },
          context: { oauthCredential: credential.credentialId, domain: credential.domain },
          personalSearchSetup: connectorType,
          request: { kind: 'list', cursor: 'page-2' },
        },
      })
    }
  )

  it('reuses a prepared account, validates all selected keys, and creates the source without another OAuth attempt', async () => {
    mocks.selector
      .mockResolvedValueOnce({
        kind: 'list',
        items: [{ id: 'PROJECT', label: 'Project' }],
        nextCursor: '50',
      })
      .mockResolvedValueOnce({ kind: 'list', items: [{ id: 'SECOND', label: 'Second' }] })
    await expect(runConnect({ keys: ['PROJECT', 'SECOND', 'PROJECT'] })).resolves.toEqual({
      kind: 'connected',
      knowledgeBaseId: 'kb-1',
      connectorId: 'source-1',
    })
    expect(mocks.selector).toHaveBeenCalledTimes(2)
    expect(mocks.configure).toHaveBeenCalledWith({
      principal,
      request: undefined,
      input: {
        organizationId: owner.organizationId,
        connectorType: 'jira',
        memberCredentialBinding: {
          credentialGroupId: 'group-1',
          credentialGroupOptionId: 'option-1',
        },
        sourceConfig: { domain: credential.domain, projectKey: 'PROJECT,SECOND' },
      },
    })
    expect(mocks.dispatch).toHaveBeenCalledWith('source-1', {
      billingAttribution: { actorUserId: principal.userId },
    })
    expect(mocks.oauth).not.toHaveBeenCalled()
  })

  it.each([
    { kind: 'list', items: [], truncated: true, nextCursor: '50' },
    { kind: 'list', items: [] },
  ])('rejects unavailable manually entered keys before source creation %#', async (page) => {
    mocks.selector.mockResolvedValue(page)
    await expect(runConnect({ keys: ['MISSING'] })).rejects.toThrow('could not be found')
    expect(mocks.configure).not.toHaveBeenCalled()
  })

  it('rejects a repeated pagination cursor without looping or creating a source', async () => {
    mocks.selector.mockResolvedValue({ kind: 'list', items: [], nextCursor: '50' })
    await expect(runConnect()).rejects.toThrow('could not be found')
    expect(mocks.selector).toHaveBeenCalledTimes(2)
    expect(mocks.configure).not.toHaveBeenCalled()
  })

  it('rejects stale or wrong-user credentials before provider calls', async () => {
    mocks.ownAccount.mockRejectedValue(new Error('Account unavailable'))
    await expect(runConnect()).rejects.toThrow('Account unavailable')
    expect(mocks.selector).not.toHaveBeenCalled()
    expect(mocks.configure).not.toHaveBeenCalled()
  })

  it('rejects an account whose enrollment group differs from the organization setup', async () => {
    mocks.binding.mockResolvedValue({
      organizationId: owner.organizationId,
      credentialGroupId: 'other-group',
      credentialGroupOptionId: 'option-1',
    })
    await expect(runConnect()).rejects.toThrow('Connect your account again')
    expect(mocks.configure).not.toHaveBeenCalled()
  })

  it('rejects a current operation authorization denial before any setup effects', async () => {
    mocks.authorizeOperation.mockRejectedValue(new Error('Membership ended'))
    await expect(runConnect()).rejects.toThrow('Membership ended')
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.configure).not.toHaveBeenCalled()
  })

  it.each([
    'example.atlassian.net/wiki/spaces',
    'user:password@example.atlassian.net',
    'example.atlassian.net?site=other',
  ])('rejects an invalid site value before discovery: %s', async (domain) => {
    await expect(runConnect({ domain })).rejects.toThrow('hostname')
    expect(mocks.selector).not.toHaveBeenCalled()
  })

  it('keeps the configured source available if the best-effort initial dispatch fails', async () => {
    mocks.dispatch.mockRejectedValue(new Error('Queue temporarily unavailable'))
    await expect(runConnect()).resolves.toMatchObject({
      kind: 'connected',
      connectorId: 'source-1',
    })
  })
})
