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
}))
vi.mock('@/lib/sim-search/live/providers', () => ({
  PROVIDER_ORIGINS: {
    google_drive: 'https://www.googleapis.com',
    gmail: 'https://gmail.googleapis.com',
  },
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
