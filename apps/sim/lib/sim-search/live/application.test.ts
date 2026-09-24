/** @vitest-environment node */
import { resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: true,
  permission: vi.fn(),
  context: vi.fn(),
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
vi.mock('@/lib/core/security/input-validation.server', () => ({
  createPinnedConnectionPool: () => ({ agent: vi.fn(), destroy: mocks.destroyPool }),
}))
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
vi.mock('@/lib/core/config/env-flags', () => ({
  get isLiveEnterpriseSearchEnabled() {
    return mocks.enabled
  },
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null) => actual !== null,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOwnerContext: mocks.context,
}))
vi.mock('@/lib/sim-search/live/accounts', () => ({
  listLiveAccounts: mocks.accounts,
  resolveLiveAccount: mocks.resolveAccount,
  resolveListedLiveAccount: async (owner: unknown, userId: string, listed: { id: string }) => ({
    ...(await mocks.resolveAccount(owner, userId, listed.id)),
    account: listed,
  }),
}))
vi.mock('@/lib/sim-search/live/providers', () => ({
  NATIVE_SEARCH_GUIDANCE: 'Live coverage',
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

const principal = { kind: 'session', userId: 'reader', sessionId: 's' } as const
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
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.enabled = true
    mocks.service.mockResolvedValue(undefined)
    mocks.context.mockResolvedValue({
      workspaceId: 'workspace',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'payer',
    })
    mocks.permission.mockResolvedValue('read')
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
  it('propagates generic dates, sorts matching results, and reports missing-date coverage', async () => {
    const filters = {
      startDate: '2026-09-01T00:00:00Z',
      endDate: '2026-10-01T00:00:00Z',
      sortBy: 'newest' as const,
    }
    mocks.search.mockResolvedValue({
      documents: [
        {
          ...document,
          id: 'old',
          url: 'https://docs.google.com/old',
          modifiedAt: '2026-09-02T00:00:00Z',
        },
        {
          ...document,
          id: 'outside',
          url: 'https://docs.google.com/outside',
          modifiedAt: '2026-08-01T00:00:00Z',
        },
        {
          ...document,
          id: 'missing',
          url: 'https://docs.google.com/missing',
          modifiedAt: undefined,
        },
        {
          ...document,
          id: 'new',
          url: 'https://docs.google.com/new',
          modifiedAt: '2026-09-20T00:00:00Z',
        },
      ],
    })
    const result = await searchLiveKnowledge.execute({
      principal,
      input: { ...input, query: '', filters },
    })
    expect(result.results.map((row) => decodeLiveReference(row.documentId).id)).toEqual([
      'new',
      'old',
    ])
    expect(result.results[0]).toMatchObject({
      sourceDate: '2026-09-20T00:00:00Z',
      sourceDateType: 'modified',
    })
    expect(result.retrieval?.status).toBe('partial')
    expect(result.live?.accounts[0]?.message).toContain('lacked date metadata')
    expect(mocks.search).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ filters })
    )
  })
  it('reports more matches as a cursor, not as degraded coverage', async () => {
    mocks.search.mockResolvedValue({ documents: [document], nextCursor: 'next', hasMore: true })
    const result = await searchLiveKnowledge.execute({ principal, input: { ...input, topK: 1 } })
    expect(result.retrieval.status).toBe('complete')
    expect(result.live?.accounts[0]).toMatchObject({ status: 'ok', nextCursor: 'next' })
  })
  it('keeps more matches partial when a date order must cover them', async () => {
    mocks.search.mockResolvedValue({ documents: [document], nextCursor: 'next' })
    const result = await searchLiveKnowledge.execute({
      principal,
      input: { ...input, filters: { sortBy: 'newest' } },
    })
    expect(result.retrieval.status).toBe('partial')
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
  it('keeps verified results and names a rate limit hit during verification', async () => {
    mocks.search.mockResolvedValue({
      documents: [document, { ...document, id: 'other', url: 'https://docs.google.com/other' }],
    })
    mocks.service.mockResolvedValue({
      policy: defaultLiveSearchPolicy(),
      partial: false,
      verify: async ({ id }: { id: string }) => {
        if (id === 'other') throw new NativeSearchError('rate_limited', 'Later', 30)
        return true
      },
    })
    const result = await searchLiveKnowledge.execute({ principal, input })
    expect(result.results).toHaveLength(1)
    expect(result.live?.accounts[0]).toMatchObject({
      status: 'partial',
      message: expect.stringContaining('rate-limited verification'),
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
  it('verifies GitLab candidates with the evidence from their own search response', async () => {
    const gitlab = {
      ...account,
      id: 'gitlab-source:source',
      provider: 'gitlab',
      type: 'admin_source',
    }
    const evidence = { confidential: false, authorId: 7, assigneeIds: [] }
    mocks.accounts.mockResolvedValue([gitlab])
    mocks.resolveAccount.mockResolvedValue({
      account: gitlab,
      accessToken: 'admin-secret',
      origin: 'https://gitlab.company.com',
      adminSource: { id: 'source', config: { project: '42' } },
    })
    mocks.adminSearch.mockResolvedValue({
      documents: [
        { ...document, id: '5', container: '42', kind: 'issues', accessMetadata: evidence },
      ],
    })
    await searchLiveKnowledge.execute({ principal, input })
    expect(mocks.adminVerify).toHaveBeenCalledWith(expect.objectContaining({ id: '5' }), evidence)
  })
  it('merges equal ranks in a stable account order', async () => {
    const gmail = { ...account, id: 'mail', provider: 'gmail', displayName: 'Mail' }
    mocks.accounts.mockResolvedValue([gmail, account])
    mocks.search.mockImplementation(async (provider: string) => ({
      documents: [{ ...document, id: provider, url: `https://docs.google.com/${provider}` }],
    }))
    const result = await searchLiveKnowledge.execute({ principal, input })
    mocks.accounts.mockResolvedValue([account, gmail])
    const reversed = await searchLiveKnowledge.execute({ principal, input })
    const order = (data: typeof result) => data.results.map((row) => row.connectorType)
    expect(order(reversed)).toEqual(order(result))
  })
  it('reports partial coverage when more matches exist that no cursor reaches', async () => {
    mocks.search.mockResolvedValue({ documents: [document], hasMore: true })
    const result = await searchLiveKnowledge.execute({ principal, input })
    expect(result.results).toHaveLength(1)
    expect(result.live?.accounts[0]).toMatchObject({ status: 'partial' })
  })
  it('keeps the read page budget of indexed reads at any chunk limit', async () => {
    mocks.read.mockResolvedValue({ ...document, content: 'x'.repeat(30_000) })
    const search = await searchLiveKnowledge.execute({ principal, input })
    const read = (limit: number) =>
      readLiveDocument.execute({
        principal,
        input: {
          workspaceId: 'workspace',
          documentId: search.results[0]!.documentId,
          limit,
          resultSecretRegistry: new ResolvedSecretTraceRegistry([]),
        },
      })
    expect((await read(3)).chunks[0]?.content).toHaveLength(8000)
    expect((await read(8)).chunks[0]?.content).toHaveLength(8000)
  })
  it('centers the preview on the query match', async () => {
    mocks.search.mockResolvedValue({
      documents: [{ ...document, content: `${'filler '.repeat(500)}launch checklist` }],
    })
    const result = await searchLiveKnowledge.execute({ principal, input })
    expect(result.results[0]?.content).toContain('launch checklist')
  })
  it('keeps the first verified copy of an item a provider returned twice', async () => {
    mocks.search.mockResolvedValue({
      documents: [
        {
          ...document,
          id: 'primary-copy',
          url: 'https://calendar.google.com/a',
          dedupeKey: 'meeting',
        },
        {
          ...document,
          id: 'team-copy',
          url: 'https://calendar.google.com/b',
          dedupeKey: 'meeting',
        },
      ],
    })
    mocks.service.mockResolvedValue({
      policy: defaultLiveSearchPolicy(),
      partial: false,
      verify: async ({ id }: { id: string }) => id === 'team-copy',
    })
    const result = await searchLiveKnowledge.execute({ principal, input })
    expect(result.results.map((row) => decodeLiveReference(row.documentId).id)).toEqual([
      'team-copy',
    ])
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
  it('drops the cursor of an account whose results were cut from the merge', async () => {
    const gmail = { ...account, id: 'mail', provider: 'gmail', displayName: 'Mail' }
    mocks.accounts.mockResolvedValue([account, gmail])
    mocks.search.mockImplementation(async (provider: string) => ({
      documents: [1, 2].map((rank) => ({
        ...document,
        id: `${provider}-${rank}`,
        url: `https://docs.google.com/${provider}-${rank}`,
      })),
      nextCursor: 'next',
    }))
    const result = await searchLiveKnowledge.execute({ principal, input: { ...input, topK: 2 } })
    expect(result.results).toHaveLength(2)
    for (const status of result.live?.accounts ?? []) {
      expect(status.nextCursor).toBeUndefined()
      expect(status.message).toContain('Search this account alone')
    }
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
  it('reports a dated search partial when the provider has more it cannot continue', async () => {
    mocks.search.mockResolvedValue({ documents: [document], hasMore: true })
    const result = await searchLiveKnowledge.execute({
      principal,
      input: {
        ...input,
        filters: { startDate: '2026-08-01T00:00:00Z', endDate: '2026-10-01T00:00:00Z' },
      },
    })
    expect(result.results).toHaveLength(1)
    expect(result.live?.accounts[0]).toMatchObject({
      status: 'partial',
      message: expect.stringContaining('could return'),
    })
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
  it('releases the connection pool once, even when the search is cancelled mid-flight', async () => {
    await searchLiveKnowledge.execute({ principal, input })
    expect(mocks.destroyPool).toHaveBeenCalledOnce()
    mocks.destroyPool.mockClear()
    const controller = new AbortController()
    mocks.search.mockImplementation(async () => {
      controller.abort()
      throw new NativeSearchError('unavailable', 'Cancelled')
    })
    await expect(
      searchLiveKnowledge.execute({ principal, input: { ...input, signal: controller.signal } })
    ).rejects.toThrow()
    expect(mocks.destroyPool).toHaveBeenCalledOnce()
  })
  it('reports partial coverage when more matches exist but none could be returned', async () => {
    mocks.search.mockResolvedValue({ documents: [], hasMore: true })
    const result = await searchLiveKnowledge.execute({ principal, input })
    expect(result.retrieval.status).toBe('partial')
    expect(result.live?.accounts[0]?.message).toContain('could return')
  })
  it('reports partial coverage when a continuable page returned nothing readable', async () => {
    mocks.search.mockResolvedValue({ documents: [], nextCursor: 'next' })
    const result = await searchLiveKnowledge.execute({ principal, input })
    expect(result.retrieval.status).toBe('partial')
    expect(result.live?.accounts[0]).toMatchObject({ status: 'partial', nextCursor: 'next' })
  })
  it('searches with only a native query and still rejects a search with neither', async () => {
    const nativeQueries = [{ provider: 'google_drive' as const, query: "name contains 'Q4'" }]
    await searchLiveKnowledge.execute({ principal, input: { ...input, query: '', nativeQueries } })
    expect(mocks.search).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ native: expect.objectContaining(nativeQueries[0]) })
    )
    await expect(
      searchLiveKnowledge.execute({
        principal,
        input: { ...input, query: '', nativeQueries: [{ provider: 'google_drive', query: '' }] },
      })
    ).rejects.toThrow()
    expect(mocks.search).toHaveBeenCalledOnce()
  })
  it('searches each GitHub kind of one account through one session and reports it separately', async () => {
    const github = { ...account, id: 'github-account', provider: 'github', providerId: 'github' }
    mocks.accounts.mockResolvedValue([github])
    mocks.resolveAccount.mockResolvedValue({ account: github, accessToken: 'secret' })
    mocks.search.mockImplementation(async (_provider, _client, search) =>
      search.native.kind === 'commits'
        ? { documents: [], nextCursor: '2' }
        : Promise.reject(new NativeSearchError('rate_limited', 'Slow down.', 30))
    )
    const nativeQueries = (['issues', 'commits'] as const).map((kind) => ({
      provider: 'github' as const,
      query: 'repo:org/repo launch',
      accountId: 'github-account',
      kind,
    }))
    const result = await searchLiveKnowledge.execute({
      principal,
      input: { ...input, query: '', nativeQueries },
    })
    expect(mocks.resolveAccount).toHaveBeenCalledOnce()
    expect(mocks.search.mock.calls.map(([, , search]) => search.native.kind)).toEqual([
      'issues',
      'commits',
    ])
    expect(result.live?.accounts).toEqual([
      expect.objectContaining({
        accountId: 'github-account',
        kind: 'issues',
        status: 'rate_limited',
        retryAfterSeconds: 30,
      }),
      expect.objectContaining({
        accountId: 'github-account',
        kind: 'commits',
        status: 'partial',
        nextCursor: '2',
      }),
    ])
  })
  it('reports each targeted kind of an unconnected account for reconnection', async () => {
    const nativeQueries = (['issues', 'commits'] as const).map((kind) => ({
      provider: 'github' as const,
      query: 'repo:org/repo launch',
      kind,
    }))
    const result = await searchLiveKnowledge.execute({
      principal,
      input: { ...input, query: '', nativeQueries },
    })
    expect(result.live?.accounts).toEqual([
      expect.objectContaining({ provider: 'github', kind: 'issues', status: 'reconnect' }),
      expect.objectContaining({ provider: 'github', kind: 'commits', status: 'reconnect' }),
    ])
  })
  it('rejects invalid dates before resolving provider credentials', async () => {
    await expect(
      searchLiveKnowledge.execute({
        principal,
        input: { ...input, query: '', filters: { startDate: 'today' } },
      })
    ).rejects.toThrow()
    expect(mocks.resolveAccount).not.toHaveBeenCalled()
    expect(mocks.search).not.toHaveBeenCalled()
  })
  it('searches current personal grants without loading any knowledge base', async () => {
    const result = await searchLiveKnowledge.execute({ principal, input })
    expect(result.results).toHaveLength(1)
    expect(result.live?.backend).toBe('live')
    expect(mocks.accounts).toHaveBeenCalledWith(input, 'reader')
    expect(mocks.resolveAccount).toHaveBeenCalledWith(input, 'reader', 'account')
    expect(decodeLiveReference(result.results[0].documentId)).toMatchObject({
      user: 'reader',
      account: 'account',
      id: 'doc',
    })
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
  it('returns no candidates when the requested dates do not overlap the service source', async () => {
    const verify = vi.fn(async () => true)
    mocks.service.mockResolvedValue({
      policy: defaultLiveSearchPolicy(),
      verify,
      partial: false,
      scopeSearch: () => null,
    })
    const result = await searchLiveKnowledge.execute({ principal, input })
    expect(result.results).toEqual([])
    expect(result.live?.accounts[0]?.status).toBe('ok')
    expect(mocks.search).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
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
    mocks.permission.mockResolvedValue(null)
    await expect(searchLiveKnowledge.execute({ principal, input })).rejects.toThrow(
      'Insufficient workspace'
    )
    expect(mocks.accounts).not.toHaveBeenCalled()
    expect(mocks.search).not.toHaveBeenCalled()
  })
  it('refuses live execution when the backend flag is off', async () => {
    mocks.enabled = false
    await expect(searchLiveKnowledge.execute({ principal, input })).rejects.toThrow(
      'Live search is not enabled'
    )
    expect(mocks.accounts).not.toHaveBeenCalled()
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
  it('keeps successful accounts when another provider is rate limited', async () => {
    mocks.accounts.mockResolvedValue([account, { ...account, id: 'mail', provider: 'gmail' }])
    mocks.search.mockImplementation(async (provider: string) => {
      if (provider === 'gmail') throw new NativeSearchError('rate_limited', 'Later', 30)
      return { documents: [document] }
    })
    const result = await searchLiveKnowledge.execute({ principal, input })
    expect(result.results).toHaveLength(1)
    expect(result.retrieval.status).toBe('partial')
    expect(result.live?.accounts[1]).toMatchObject({
      status: 'rate_limited',
      retryAfterSeconds: 30,
    })
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
