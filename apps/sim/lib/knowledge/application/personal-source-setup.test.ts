/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { MAX_SELECTOR_PAGES } from '@/lib/selectors/limits'
import type { SelectorRequest } from '@/lib/selectors/types'

interface ValidationSelectorCall {
  input: { request: SelectorRequest; signal: AbortSignal }
}

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
  afterEach(() => {
    vi.restoreAllMocks()
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
    mocks.selector.mockResolvedValueOnce(page).mockResolvedValue({ kind: 'detail', item: null })
    await expect(runConnect({ keys: ['MISSING'] })).rejects.toThrow('could not be found')
    expect(mocks.configure).not.toHaveBeenCalled()
  })

  it.each(['jira', 'confluence'] as const)(
    'verifies a manually entered %s key outside the available listing through the same authorized selector',
    async (connectorType) => {
      mocks.selector
        .mockResolvedValueOnce({ kind: 'list', items: [] })
        .mockResolvedValueOnce({ kind: 'detail', item: { id: 'PROJECT', label: 'Project' } })
      await expect(runConnect({ connectorType })).resolves.toMatchObject({ kind: 'connected' })
      expect(mocks.selector).toHaveBeenLastCalledWith({
        principal,
        request: undefined,
        input: {
          selectorKey: connectorType === 'jira' ? 'jira.projectKeys' : 'confluence.spaces',
          scope: { kind: 'organization', organizationId: owner.organizationId },
          context: { oauthCredential: credential.credentialId, domain: credential.domain },
          personalSearchSetup: connectorType,
          signal: expect.any(AbortSignal),
          request: { kind: 'detail', id: 'PROJECT' },
        },
      })
      expect(mocks.ownAccount).toHaveBeenCalledTimes(2)
      expect(mocks.oauth).not.toHaveBeenCalled()
    }
  )

  it.each([
    { name: 'truncated results', pages: 1, truncated: true, nextCursor: '50' },
    { name: 'a repeated cursor', pages: 2, nextCursor: '50' },
    { name: 'the page limit', pages: MAX_SELECTOR_PAGES },
  ])('resolves remaining keys directly after $name', async ({ pages, truncated, nextCursor }) => {
    let listed = 0
    mocks.selector.mockImplementation(({ input }: ValidationSelectorCall) => {
      if (input.request.kind === 'detail') {
        return { kind: 'detail', item: { id: input.request.id, label: 'Project' } }
      }
      listed++
      return { kind: 'list', items: [], nextCursor: nextCursor ?? String(listed), truncated }
    })
    await expect(runConnect()).resolves.toMatchObject({ kind: 'connected' })
    expect(listed).toBe(pages)
    expect(mocks.selector).toHaveBeenCalledTimes(pages + 1)
    expect(mocks.oauth).not.toHaveBeenCalled()
  })

  it('gives direct validation a fresh deadline when listing times out', async () => {
    const listing = new AbortController()
    const details = new AbortController()
    vi.spyOn(AbortSignal, 'timeout')
      .mockReturnValueOnce(listing.signal)
      .mockReturnValueOnce(details.signal)
    mocks.selector
      .mockImplementationOnce(({ input }: ValidationSelectorCall) => {
        listing.abort(new DOMException('Listing timed out', 'TimeoutError'))
        input.signal.throwIfAborted()
      })
      .mockImplementationOnce(({ input }: ValidationSelectorCall) => {
        expect(input.signal.aborted).toBe(false)
        expect(input.request).toEqual({ kind: 'detail', id: 'PROJECT' })
        return { kind: 'detail', item: { id: 'PROJECT', label: 'Project' } }
      })
    await expect(runConnect()).resolves.toMatchObject({ kind: 'connected' })
    expect(AbortSignal.timeout).toHaveBeenCalledTimes(2)
    expect(mocks.oauth).not.toHaveBeenCalled()
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

  it('does not retry direct validation after the caller cancels listing', async () => {
    const caller = new AbortController()
    mocks.selector.mockImplementationOnce(({ input }: ValidationSelectorCall) => {
      caller.abort(new Error('Setup cancelled'))
      input.signal.throwIfAborted()
    })
    await expect(
      personalSourceSetup.execute({
        principal,
        input: { ...connect, keys: ['PROJECT'] },
        request: { headers: new Headers(), signal: caller.signal },
      })
    ).rejects.toThrow('Setup cancelled')
    expect(mocks.selector).toHaveBeenCalledTimes(1)
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

  it('propagates listing failures without starting direct validation', async () => {
    mocks.selector.mockRejectedValueOnce(new Error('Account revoked'))
    await expect(runConnect()).rejects.toThrow('Account revoked')
    expect(mocks.selector).toHaveBeenCalledTimes(1)
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

  it.each(['binding', 'ownership'] as const)(
    'stops before source creation if the caller cancels during the final %s check',
    async (phase) => {
      const caller = new AbortController()
      if (phase === 'binding') {
        mocks.binding.mockImplementationOnce(() => {
          caller.abort(new Error('Setup cancelled'))
          return {
            organizationId: owner.organizationId,
            credentialGroupId: 'group-1',
            credentialGroupOptionId: 'option-1',
          }
        })
      } else {
        mocks.ownAccount.mockResolvedValueOnce(account).mockImplementationOnce(() => {
          caller.abort(new Error('Setup cancelled'))
          return account
        })
      }
      await expect(
        personalSourceSetup.execute({
          principal,
          input: { ...connect, keys: ['PROJECT'] },
          request: { headers: new Headers(), signal: caller.signal },
        })
      ).rejects.toThrow('Setup cancelled')
      expect(mocks.configure).not.toHaveBeenCalled()
      expect(mocks.dispatch).not.toHaveBeenCalled()
    }
  )

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
