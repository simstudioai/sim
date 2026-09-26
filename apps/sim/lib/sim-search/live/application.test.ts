import { resetDbChainMock } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  resolveAccount: vi.fn(),
  search: vi.fn(),
  read: vi.fn(),
  admin: vi.fn(),
  adminSearch: vi.fn(),
  adminRead: vi.fn(),
  adminVerify: vi.fn(),
  json: vi.fn(),
  service: vi.fn(),
  destroyPool: vi.fn(),
}))
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/sim-search/live/service-session', () => ({
  createLiveServiceSession: mocks.service,
}))
vi.mock('@/lib/sim-search/live/http', async (original) => ({
  ...(await original<typeof import('@/lib/sim-search/live/http')>()),
  createNativeClient: () => ({ json: mocks.json, text: vi.fn() }),
}))
vi.mock('@/lib/sim-search/live/gitlab-admin', () => ({ createAdminGitLabSession: mocks.admin }))
vi.mock('@/lib/sim-search/live/policy-store', () => ({
  loadLiveSearchPolicies: vi.fn(async () => ({})),
  livePolicyFor: vi.fn(() => defaultLiveSearchPolicy()),
}))
vi.mock('@/lib/sim-search/live/coda-mcp', () => ({
  createCodaMcpClient: vi.fn(),
  searchCodaMcp: vi.fn(),
  readCodaMcp: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/sim-search/live/accounts', () => ({
  listLiveAccounts: mocks.accounts,
  resolveLiveAccount: mocks.resolveAccount,
  resolveListedLiveAccount: async (owner: unknown, userId: string, listed: { id: string }) => ({
    ...(await mocks.resolveAccount(owner, userId, listed.id)),
    account: listed,
  }),
}))
vi.mock('@/lib/sim-search/live/providers', () => ({
  liveSearchGuidance: (providers: string[]) => `Live coverage: ${[...new Set(providers)]}`,
  searchNativeProvider: mocks.search,
  readNativeProvider: mocks.read,
}))
vi.mock('@/executor/utils/resolved-secret-content-projection', () => ({
  projectResolvedSecretModelContent: (value: string) => ({ safe: true, value }),
}))

import {
  decodeLiveReference,
  encodeLiveReference,
  matchesLiveFilters,
  readLiveDocument,
  searchLiveKnowledge,
} from '@/lib/sim-search/live/application'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import { createPolicyVerifier } from '@/lib/sim-search/live/policy'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

workspaceAuthzMockFns.mockPermissionSatisfies.mockImplementation(
  (actual: string | null) => actual !== null
)
inputValidationMockFns.mockCreatePinnedConnectionPool.mockImplementation(() => ({
  agent: vi.fn(),
  destroy: mocks.destroyPool,
}))

const principal = createSessionPrincipal({ userId: 'reader', sessionId: 's' })
const input = { workspaceId: 'workspace', query: 'launch', topK: 20 }
const account = {
  id: 'account',
  provider: 'google_drive',
  providerId: 'google-drive',
  displayName: 'My Drive',
  type: 'oauth',
  scopes: [],
}
const document = {
  id: 'doc',
  title: 'Launch',
  content: 'Evidence',
  url: 'https://docs.google.com/document/d/doc/edit',
  modifiedAt: '2026-09-01T00:00:00Z',
}

describe('authorized live retrieval', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.service.mockResolvedValue(undefined)
    knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext.mockResolvedValue({
      workspaceId: 'workspace',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'payer',
    })
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
    mocks.accounts.mockResolvedValue([account])
    mocks.resolveAccount.mockResolvedValue({ account, accessToken: 'secret' })
    mocks.search.mockResolvedValue({ documents: [document] })
    mocks.read.mockResolvedValue(document)
    mocks.admin.mockResolvedValue({
      search: mocks.adminSearch,
      read: mocks.adminRead,
      verify: mocks.adminVerify,
    })
    mocks.adminSearch.mockResolvedValue({
      documents: [{ ...document, id: 'src/a.ts', container: '42', kind: 'code' }],
    })
    mocks.adminVerify.mockResolvedValue(true)
  })
  it('filters admin-token GitLab results through the reader ACL before projection', async () => {
    const gitlab = {
      ...account,
      id: 'gitlab-source:source',
      provider: 'gitlab',
      type: 'admin_source',
    }
    mocks.accounts.mockResolvedValue([gitlab])
    mocks.resolveAccount.mockResolvedValue({
      account: gitlab,
      accessToken: 'admin-secret',
      origin: 'https://gitlab.company.com',
      adminSource: { id: 'source', config: { project: '42' } },
    })
    mocks.adminVerify.mockResolvedValue(false)
    const result = await searchLiveKnowledge.execute({ principal, input })
    expect(result.results).toEqual([])
    expect(mocks.search).not.toHaveBeenCalled()
    expect(mocks.admin).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'reader',
        source: { id: 'source', config: { project: '42' } },
      })
    )
    mocks.adminVerify.mockResolvedValue(true)
    const allowed = await searchLiveKnowledge.execute({ principal, input })
    expect(allowed.results).toHaveLength(1)
    mocks.adminVerify.mockResolvedValue(false)
    await expect(
      readLiveDocument.execute({
        principal,
        input: {
          workspaceId: 'workspace',
          documentId: allowed.results[0].documentId,
          limit: 1,
          resultSecretRegistry: new ResolvedSecretTraceRegistry([]),
        },
      })
    ).rejects.toThrow('outside')
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.adminRead).not.toHaveBeenCalled()
  })
  it('does not fall back to unrestricted GitLab search when permission discovery fails', async () => {
    const gitlab = {
      ...account,
      id: 'gitlab-source:source',
      provider: 'gitlab',
      type: 'admin_source',
    }
    mocks.accounts.mockResolvedValue([gitlab])
    mocks.resolveAccount.mockResolvedValue({
      account: gitlab,
      accessToken: 'admin-secret',
      origin: 'https://gitlab.company.com',
      adminSource: { id: 'source', config: {} },
    })
    mocks.admin.mockRejectedValue(new Error('Incomplete directory'))
    const result = await searchLiveKnowledge.execute({ principal, input })
    expect(result.results).toEqual([])
    expect(result.live?.accounts[0].status).toBe('unavailable')
    expect(mocks.search).not.toHaveBeenCalled()
    expect(mocks.adminSearch).not.toHaveBeenCalled()
  })
  it('reports candidates that could not be verified and keeps the verified ones', async () => {
    mocks.search.mockResolvedValue({
      documents: [document, { ...document, id: 'other', url: 'https://docs.google.com/other' }],
    })
    mocks.service.mockResolvedValue({
      policy: defaultLiveSearchPolicy(),
      partial: false,
      verify: async ({ id }: { id: string }) => {
        if (id === 'other') throw new NativeSearchError('unavailable', 'Budget')
        return true
      },
    })
    const result = await searchLiveKnowledge.execute({ principal, input })
    expect(result.results.map((row) => decodeLiveReference(row.documentId).id)).toEqual(['doc'])
    expect(result.live?.accounts[0]).toMatchObject({
      status: 'partial',
      message: expect.stringContaining('could not be verified'),
    })
  })
  it('fails the account when a grant is revoked during verification', async () => {
    mocks.service.mockResolvedValue({
      policy: defaultLiveSearchPolicy(),
      partial: false,
      verify: async () => {
        throw new NativeSearchError('reconnect', 'Revoked')
      },
    })
    const result = await searchLiveKnowledge.execute({ principal, input })
    expect(result.results).toEqual([])
    expect(result.live?.accounts[0]).toMatchObject({ status: 'reconnect', message: 'Revoked' })
  })
  it('reports undated exclusions only for documents the member may read', async () => {
    mocks.search.mockResolvedValue({
      documents: [{ ...document, id: 'hidden', modifiedAt: undefined }],
    })
    mocks.service.mockResolvedValue({
      policy: defaultLiveSearchPolicy(),
      partial: false,
      verify: async () => false,
    })
    const result = await searchLiveKnowledge.execute({
      principal,
      input: { ...input, filters: { modifiedAfter: '2026-01-01T00:00:00Z' } },
    })
    expect(result.live?.accounts[0]).toMatchObject({ status: 'ok' })
    expect(result.live?.accounts[0]?.message).toBeUndefined()
  })
  it('drops the cursor only for the account whose results were cut from the merge', async () => {
    const gmail = { ...account, id: 'mail', provider: 'gmail', displayName: 'Mail' }
    mocks.accounts.mockResolvedValue([account, gmail])
    mocks.search.mockImplementation(async (provider: string) => ({
      documents: (provider === 'gmail' ? [1, 2] : [1]).map((rank) => ({
        ...document,
        id: `${provider}-${rank}`,
        url: `https://docs.google.com/${provider}-${rank}`,
      })),
      nextCursor: 'next',
    }))
    const result = await searchLiveKnowledge.execute({ principal, input: { ...input, topK: 2 } })
    const statusOf = (id: string) => result.live?.accounts.find((row) => row.accountId === id)
    expect(result.results.map((row) => decodeLiveReference(row.documentId).id)).not.toContain(
      'gmail-2'
    )
    expect(statusOf('mail')?.nextCursor).toBeUndefined()
    expect(statusOf('account')).toMatchObject({ nextCursor: 'next' })
  })
  it('applies date filters before spending provider verification', async () => {
    const verify = vi.fn(async () => true)
    mocks.service.mockResolvedValue({ policy: defaultLiveSearchPolicy(), verify, partial: false })
    const outside = {
      ...document,
      id: 'outside',
      url: 'https://docs.google.com/outside',
      modifiedAt: '2026-01-01T00:00:00Z',
    }
    mocks.search.mockResolvedValue({ documents: [document, outside] })
    const result = await searchLiveKnowledge.execute({
      principal,
      input: {
        ...input,
        filters: { startDate: '2026-08-01T00:00:00Z', endDate: '2026-10-01T00:00:00Z' },
      },
    })
    expect(result.results.map((row) => decodeLiveReference(row.documentId).id)).toEqual(['doc'])
    expect(verify).toHaveBeenCalledExactlyOnceWith(document)
  })
  it('fuses alternative queries so a document several of them return ranks first', async () => {
    const slack = { ...account, id: 'slack-account', provider: 'slack', providerId: 'slack' }
    mocks.accounts.mockResolvedValue([slack])
    mocks.resolveAccount.mockResolvedValue({
      account: { ...slack, scopes: ['search:read.public'] },
      accessToken: 'secret',
    })
    const message = (id: string) => ({
      ...document,
      id,
      title: id,
      url: `https://example.slack.com/archives/C1/p${id}`,
    })
    mocks.search.mockImplementation(async (_provider, _client, search) => ({
      documents:
        search.native.query === 'trip'
          ? [message('1'), message('2')]
          : [message('3'), message('2')],
    }))
    const result = await searchLiveKnowledge.execute({
      principal,
      input: {
        ...input,
        query: '',
        nativeQueries: ['trip', 'travel'].map((query) => ({
          provider: 'slack' as const,
          accountId: 'slack-account',
          query,
        })),
      },
    })
    expect(mocks.search).toHaveBeenCalledTimes(2)
    expect(result.results.map((row) => decodeLiveReference(row.documentId).id)).toEqual([
      '2',
      '1',
      '3',
    ])
    expect(result.live?.accounts.map((status) => status.queryIndex)).toEqual([0, 1])
    expect(result.live?.guidance).toBe('Live coverage: slack')
  })
  it('checks the service source before returning member-visible candidates', async () => {
    const verify = vi.fn().mockResolvedValue(false)
    mocks.service.mockResolvedValue({ policy: defaultLiveSearchPolicy(), verify, partial: false })
    const result = await searchLiveKnowledge.execute({ principal, input })
    expect(result.results).toEqual([])
    expect(verify).toHaveBeenCalledWith(document)
    expect(mocks.search).toHaveBeenCalledOnce()
  })
  it('checks service resource restrictions with the source credential rather than the member token', async () => {
    const verify = vi.fn(async () => true)
    mocks.service.mockResolvedValue({
      policy: { ...defaultLiveSearchPolicy(), fileTypes: ['text/plain'] },
      verify,
      partial: false,
    })
    const result = await searchLiveKnowledge.execute({ principal, input })
    expect(result.results).toHaveLength(1)
    expect(verify).toHaveBeenCalledExactlyOnceWith(document)
    expect(mocks.json).not.toHaveBeenCalled()
  })
  it('fails closed when the selected service credential cannot be resolved', async () => {
    mocks.service.mockRejectedValue(new NativeSearchError('unavailable', 'Source revoked'))
    const result = await searchLiveKnowledge.execute({ principal, input })
    expect(result.results).toEqual([])
    expect(result.live?.accounts[0]?.status).toBe('unavailable')
    expect(mocks.search).not.toHaveBeenCalled()
  })
  it('rechecks service scope after reading content and suppresses a revoked document', async () => {
    const search = await searchLiveKnowledge.execute({ principal, input })
    mocks.service.mockResolvedValueOnce({
      policy: defaultLiveSearchPolicy(),
      verify: vi.fn(async () => true),
      partial: false,
    })
    mocks.service.mockResolvedValueOnce({
      policy: defaultLiveSearchPolicy(),
      verify: vi.fn(async () => false),
      partial: false,
    })
    await expect(
      readLiveDocument.execute({
        principal,
        input: {
          workspaceId: 'workspace',
          documentId: search.results[0]!.documentId,
          limit: 1,
          resultSecretRegistry: new ResolvedSecretTraceRegistry([]),
        },
      })
    ).rejects.toThrow('outside your organization')
    expect(mocks.read).toHaveBeenCalledOnce()
  })
  it('rejects nonmembers before account discovery or provider calls', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)
    await expect(searchLiveKnowledge.execute({ principal, input })).rejects.toThrow(
      'Insufficient workspace'
    )
    expect(mocks.accounts).not.toHaveBeenCalled()
    expect(mocks.search).not.toHaveBeenCalled()
  })
  it('does not substitute the billing owner for an actorless workspace key', async () => {
    await expect(
      searchLiveKnowledge.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'workspace', apiKeyId: 'k' },
        input,
      })
    ).rejects.toThrow()
    expect(mocks.accounts).not.toHaveBeenCalled()
  })
  it('does not send a source-restricted query to other providers', async () => {
    await searchLiveKnowledge.execute({
      principal,
      input: { ...input, filters: { source: 'slack' } },
    })
    expect(mocks.resolveAccount).not.toHaveBeenCalled()
  })
  it('rechecks revoked account access on every document read', async () => {
    const search = await searchLiveKnowledge.execute({ principal, input })
    mocks.resolveAccount.mockRejectedValue(new NativeSearchError('reconnect', 'Revoked'))
    await expect(
      readLiveDocument.execute({
        principal,
        input: {
          workspaceId: 'workspace',
          documentId: search.results[0].documentId,
          limit: 3,
          resultSecretRegistry: new ResolvedSecretTraceRegistry([]),
        },
      })
    ).rejects.toThrow('Revoked')
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('rejects cross-user document references before token resolution', async () => {
    const search = await searchLiveKnowledge.execute({ principal, input })
    const reference = decodeLiveReference(search.results[0].documentId)
    mocks.resolveAccount.mockClear()
    await expect(
      readLiveDocument.execute({
        principal,
        input: {
          workspaceId: 'workspace',
          documentId: encodeLiveReference({ ...reference, user: 'someone-else' }),
          limit: 3,
          resultSecretRegistry: new ResolvedSecretTraceRegistry([]),
        },
      })
    ).rejects.toThrow('Document not found')
    expect(mocks.resolveAccount).not.toHaveBeenCalled()
  })
  it('rejects a document moved out of scope while its content was being read', async () => {
    const search = await searchLiveKnowledge.execute({ principal, input })
    const policy = {
      ...defaultLiveSearchPolicy(),
      mode: 'selected' as const,
      included: ['root'],
    }
    mocks.service.mockImplementation(async () => ({
      policy,
      verify: createPolicyVerifier(
        'google_drive',
        policy,
        { json: mocks.json, text: vi.fn() },
        'https://www.googleapis.com'
      ),
      partial: false,
    }))
    let reads = 0
    mocks.json.mockImplementation(async (path) => {
      if (path.endsWith('/doc')) return { id: 'doc', parents: [++reads === 1 ? 'root' : 'private'] }
      return { id: path.endsWith('/root') ? 'root' : 'private', parents: [] }
    })
    await expect(
      readLiveDocument.execute({
        principal,
        input: {
          workspaceId: 'workspace',
          documentId: search.results[0]!.documentId,
          limit: 3,
          resultSecretRegistry: new ResolvedSecretTraceRegistry([]),
        },
      })
    ).rejects.toThrow('outside your organization')
    expect(mocks.read).toHaveBeenCalledOnce()
    expect(reads).toBe(2)
  })
  it('cannot widen date or selected-document filters', () => {
    expect(matchesLiveFilters(document, 'a', 'google_drive', { documentIds: ['b'] })).toBe(false)
    expect(
      matchesLiveFilters(document, 'a', 'google_drive', { modifiedAfter: '2026-09-02T00:00:00Z' })
    ).toBe(false)
    expect(
      matchesLiveFilters({ ...document, modifiedAt: undefined }, 'a', 'google_drive', {
        modifiedAfter: '2026-09-02T00:00:00Z',
      })
    ).toBe(false)
  })
})
