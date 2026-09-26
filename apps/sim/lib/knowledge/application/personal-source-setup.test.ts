import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  credentialGroupsCredentialsMock,
  credentialGroupsCredentialsMockFns,
} from '@sim/testing/mocks/credential-groups-credentials.mock'
import {
  credentialGroupsEnrollmentsMock,
  credentialGroupsEnrollmentsMockFns,
} from '@sim/testing/mocks/credential-groups-enrollments.mock'
import {
  credentialGroupsSelfEnrollmentMock,
  credentialGroupsSelfEnrollmentMockFns,
} from '@sim/testing/mocks/credential-groups-self-enrollment.mock'
import { knowledgeContextsMock } from '@sim/testing/mocks/knowledge-contexts.mock'
import {
  knowledgeMemberQueueMock,
  knowledgeMemberQueueMockFns,
} from '@sim/testing/mocks/knowledge-member-queue.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  authorize: vi.fn(),
  ownAccount: vi.fn(),
  listAccounts: vi.fn(),
  completion: vi.fn(),
  provision: vi.fn(),
  oauth: vi.fn(),
  selector: vi.fn(),
  configure: vi.fn(),
  billing: vi.fn(),
}))
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/knowledge/application/personal-search-account', () => ({
  authorizePersonalSearchSetup: hoisted.authorize,
  authorizePersonalSearchSetupCredential: hoisted.ownAccount,
}))
vi.mock('@/lib/credentials/organization-managed', () => ({
  getOwnOrganizationManagedOAuthCredentials: hoisted.listAccounts,
}))
vi.mock('@/lib/credential-groups/search-connection-completion', () => ({
  readSearchConnectionCompletion: hoisted.completion,
}))
vi.mock('@/lib/knowledge/connectors/member-provisioning', () => ({
  provisionKnowledgeConnectorMembersBinding: hoisted.provision,
}))
vi.mock('@/lib/credential-groups/self-enrollment', () => credentialGroupsSelfEnrollmentMock)
vi.mock('@/lib/credential-groups/enrollments', () => credentialGroupsEnrollmentsMock)
vi.mock('@/lib/credential-groups/oauth', () => ({ startCredentialGroupOAuth: hoisted.oauth }))
vi.mock('@/lib/selectors/application/execute-selector', () => ({
  executeSelector: { execute: hoisted.selector },
}))
vi.mock('@/lib/knowledge/application/sim-search', () => ({
  configureSimSearchConnector: { execute: hoisted.configure },
}))
vi.mock('@/lib/credential-groups/credentials', () => credentialGroupsCredentialsMock)
vi.mock('@/lib/knowledge/connectors/member-queue', () => knowledgeMemberQueueMock)
vi.mock('@/lib/knowledge/application/billing', () => ({
  resolveKnowledgeBillingAttribution: hoisted.billing,
}))
vi.mock('@/connectors/registry', () => ({
  CONNECTOR_META_REGISTRY: { jira: { name: 'Jira' }, confluence: { name: 'Confluence' } },
}))

import {
  listPersonalSourceSetupAccounts,
  personalSourceSetup,
} from '@/lib/knowledge/application/personal-source-setup'
import type { SelectorRequest } from '@/lib/selectors/types'

const mocks = {
  ...hoisted,
  enrollment: credentialGroupsSelfEnrollmentMockFns.mockCreateViewerCredentialGroupEnrollment,
  oauthContext: credentialGroupsEnrollmentsMockFns.mockGetCredentialGroupOAuthContextForEnrollment,
  binding: credentialGroupsCredentialsMockFns.mockLoadManagedCredentialGroupBinding,
  group: credentialGroupsCredentialsMockFns.mockLoadScopedAccountsCredentialListContext,
  dispatch: knowledgeMemberQueueMockFns.mockDispatchMemberSync,
}

interface ValidationSelectorCall {
  input: { request: SelectorRequest; signal: AbortSignal }
}

const principal = createSessionPrincipal({ userId: 'member-1' })
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
  it.each(['confluence', 'jira'] as const)(
    'rejects mixed All and explicit %s keys before discovery or saving',
    async (connectorType) => {
      await expect(runConnect({ connectorType, keys: ['*', 'ENG'] })).rejects.toThrow(
        'Use "*" by itself for All, or remove it to select individual items.'
      )
      expect(mocks.selector).not.toHaveBeenCalled()
      expect(mocks.configure).not.toHaveBeenCalled()
    }
  )

  it('does not let All bypass a failed site or credential check', async () => {
    mocks.selector.mockRejectedValue(new Error('Site unavailable'))
    await expect(runConnect({ keys: ['*'] })).rejects.toThrow('Site unavailable')
    expect(mocks.configure).not.toHaveBeenCalled()
  })

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

  it.each([
    { kind: 'list', items: [], truncated: true, nextCursor: '50' },
    { kind: 'list', items: [] },
  ])('rejects unavailable manually entered keys before source creation %#', async (page) => {
    mocks.selector.mockResolvedValueOnce(page).mockResolvedValue({ kind: 'detail', item: null })
    await expect(runConnect({ keys: ['MISSING'] })).rejects.toThrow('could not be found')
    expect(mocks.configure).not.toHaveBeenCalled()
  })

  it('fails before mutation when direct validation also exceeds its deadline', async () => {
    const listing = new AbortController()
    const details = new AbortController()
    vi.spyOn(AbortSignal, 'timeout')
      .mockReturnValueOnce(listing.signal)
      .mockReturnValueOnce(details.signal)
    mocks.selector
      .mockResolvedValueOnce({ kind: 'list', items: [] })
      .mockImplementationOnce(({ input }: ValidationSelectorCall) => {
        details.abort(new DOMException('Validation timed out', 'TimeoutError'))
        input.signal.throwIfAborted()
      })
    await expect(runConnect()).rejects.toThrow('took too long')
    expect(mocks.configure).not.toHaveBeenCalled()
  })

  it('rejects a detail response for a different key', async () => {
    mocks.selector
      .mockResolvedValueOnce({ kind: 'list', items: [] })
      .mockResolvedValueOnce({ kind: 'detail', item: { id: 'OTHER', label: 'Other project' } })
    await expect(runConnect()).rejects.toThrow('could not be found')
    expect(mocks.configure).not.toHaveBeenCalled()
  })

  it('bounds direct validation concurrency and validates each unresolved key only once', async () => {
    let release = () => {}
    let allStarted = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      allStarted = resolve
    })
    let active = 0
    let maximumActive = 0
    mocks.selector.mockImplementation(async ({ input }: ValidationSelectorCall) => {
      if (input.request.kind === 'list') return { kind: 'list', items: [] }
      active++
      maximumActive = Math.max(maximumActive, active)
      if (active === 5) allStarted()
      await gate
      active--
      return { kind: 'detail', item: { id: input.request.id, label: input.request.id } }
    })
    const keys = Array.from({ length: 12 }, (_, index) => `PROJECT${index}`)
    const connection = runConnect({ keys: [...keys, ...keys] })
    await started
    try {
      expect(mocks.selector).toHaveBeenCalledTimes(6)
      expect(mocks.configure).not.toHaveBeenCalled()
    } finally {
      release()
    }
    await expect(connection).resolves.toMatchObject({ kind: 'connected' })
    expect(maximumActive).toBe(5)
    expect(mocks.selector).toHaveBeenCalledTimes(keys.length + 1)
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
    organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation.mockRejectedValue(
      new Error('Membership ended')
    )
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
})
