import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { setEnv } from '@sim/testing/mocks/env.mock'
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
  mcpCall: vi.fn(),
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
  createNativeClient: () => ({
    json: mocks.json,
    text: vi.fn(async () => 'Original document text'),
    bytes: vi.fn(),
  }),
}))
vi.mock('@/lib/sim-search/live/gitlab-admin', () => ({ createAdminGitLabSession: mocks.admin }))
vi.mock('@/lib/sim-search/live/policy-store', () => ({
  loadLiveSearchPolicies: vi.fn(async () => ({})),
  livePolicyFor: vi.fn(() => defaultLiveSearchPolicy()),
}))
vi.mock('@/lib/sim-search/live/managed-mcp', () => ({
  createManagedSearchMcpClient: async () => ({ call: mocks.mcpCall, close: async () => {} }),
}))
vi.mock('@/lib/sim-search/live/coda-mcp', () => ({
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
import { readDrive } from '@/lib/sim-search/live/google'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import { createPolicyVerifier } from '@/lib/sim-search/live/policy'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import { livePolicyFor } from '@/lib/sim-search/live/policy-store'
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
    vi.mocked(livePolicyFor).mockReset()
    vi.mocked(livePolicyFor).mockReturnValue(defaultLiveSearchPolicy())
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
  describe('Zoom continuation integrity', () => {
    const connected = {
      ...account,
      provider: 'zoom' as const,
      providerId: 'mcp:zoom',
      type: 'managed_mcp' as const,
      displayName: 'Fixture meetings',
    }
    const ids = {
      first: '00000000-0000-4000-8000-000000000001',
      prior: '00000000-0000-4000-8000-000000000002',
      later: '00000000-0000-4000-8000-000000000003',
    }
    const listing = {
      ...input,
      query: '',
      topK: 2,
      filters: { sortBy: 'newest' as const },
      nativeQueries: [{ provider: 'zoom' as const, accountId: connected.id, query: '' }],
    }
    let providerUsesCutoff = true
    beforeEach(() => {
      providerUsesCutoff = true
      setEnv({ ZOOM_SEARCH: true })
      dbChainMockFns.limit.mockResolvedValue([{ organizationId: 'org' }])
      mocks.accounts.mockResolvedValue([connected])
      mocks.mcpCall.mockImplementation(async (name: string, args: Record<string, unknown>) => {
        if (name === 'search_meetings') {
          const pageIds = !args.next_page_token
            ? [ids.first]
            : providerUsesCutoff
              ? [
                  Date.parse(String(args.to)) <= Date.parse('2026-09-01T12:00:00Z')
                    ? ids.prior
                    : ids.later,
                ]
              : [ids.prior, ids.later]
          return {
            meetings: pageIds.map((id) => ({ meeting_uuid: id, meeting_category: 'history' })),
            next_page_token: args.next_page_token ? '' : 'fixture-second-page',
          }
        }
        if (name !== 'get_meeting_assets') throw new Error('Unexpected meeting tool')
        return {
          meeting_uuid: args.meetingId,
          meeting_category: 'history',
          topic: 'Fixture meeting',
          start_time:
            args.meetingId === ids.later ? '2026-09-01T12:30:00Z' : '2026-09-01T11:30:00Z',
          deep_url: 'https://zoom.us/meeting/insights/fixture',
        }
      })
    })
    it.each(['inferred cutoff', 'provider cursor'] as const)(
      'rejects a caller-edited %s from an otherwise valid continuation',
      async (changed) => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
          vi.setSystemTime(new Date('2026-09-01T12:00:00Z'))
          const first = await searchLiveKnowledge.execute({ principal, input: listing })
          expect(first.results).toHaveLength(1)
          const cursor = first.live?.accounts[0]?.nextCursor
          expect(cursor).toBeTruthy()
          const payload = JSON.parse(Buffer.from(cursor!.slice(5), 'base64url').toString('utf8'))
          if (changed === 'inferred cutoff') payload.listingEndDate = '2026-09-01T14:00:00Z'
          else payload.cursor = 'different-second-page'
          const altered = `zoom:${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
          const result = await searchLiveKnowledge.execute({
            principal,
            input: {
              ...listing,
              nativeQueries: [{ ...listing.nativeQueries[0]!, cursor: altered }],
            },
          })
          expect(result.results).toEqual([])
          expect(result.live?.accounts[0]).toMatchObject({ status: 'unavailable' })
        } finally {
          vi.useRealTimers()
        }
      }
    )
    it.each(['provider window', 'local date filtering'] as const)(
      'continues the original inferred cutoff after time advances: %s',
      async (stage) => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
          vi.setSystemTime(new Date('2026-09-01T12:00:00Z'))
          const first = await searchLiveKnowledge.execute({ principal, input: listing })
          expect(first.results).toHaveLength(1)
          const cursor = first.live?.accounts[0]?.nextCursor
          expect(cursor).toBeTruthy()
          providerUsesCutoff = stage === 'provider window'
          vi.setSystemTime(new Date('2026-09-01T13:00:00Z'))
          const result = await searchLiveKnowledge.execute({
            principal,
            input: { ...listing, nativeQueries: [{ ...listing.nativeQueries[0]!, cursor }] },
          })
          expect(result.results.map((row) => decodeLiveReference(row.documentId).id)).toEqual([
            ids.prior,
          ])
          expect(result.live?.accounts[0]?.status).not.toBe('unavailable')
        } finally {
          vi.useRealTimers()
        }
      }
    )
  })
  describe('HubSpot continuation context', () => {
    const connected = {
      ...account,
      provider: 'hubspot' as const,
      providerId: 'mcp:hubspot',
      type: 'managed_mcp' as const,
      displayName: 'Fixture CRM',
    }
    const native = {
      provider: 'hubspot' as const,
      accountId: connected.id,
      kind: 'contacts' as const,
      query: 'launch',
    }
    const filters = { startDate: '2026-08-01T00:00:00Z', endDate: '2026-10-01T00:00:00Z' }
    const row = (id: number, date: string) => ({
      id,
      displayName: `Fixture ${id}`,
      properties: { name: `Fixture ${id}`, lastmodifieddate: date, hs_lastmodifieddate: date },
    })
    const response = (args: Record<string, unknown>, rows: unknown[], total: number) => ({
      results: rows,
      total,
      offset: Number(args.offset ?? 0) + rows.length,
      urlTemplate: `https://app.hubspot.com/contacts/12345/record/${args.objectType === 'COMPANY' ? '0-2' : '0-1'}/{id}`,
    })
    const details = {
      accountId: 12345,
      toolInformation: {
        crmObjectTypeAvailability: {
          CONTACT: { read: 'AVAILABLE' },
          COMPANY: { read: 'AVAILABLE' },
        },
      },
    }
    beforeEach(() => {
      mocks.accounts.mockResolvedValue([connected, { ...connected, id: 'another-account' }])
      mocks.mcpCall.mockImplementation(async (name: string, args: Record<string, unknown>) => {
        if (name === 'get_user_details') return details
        if (name !== 'search_crm_objects') throw new Error('Unexpected CRM tool')
        return response(args, [row(args.offset ? 43 : 42, '2026-09-01T00:00:00Z')], 2)
      })
    })
    it.each([
      { name: 'query', native: { ...native, query: 'release' }, filters },
      { name: 'kind', native: { ...native, kind: 'companies' as const }, filters },
      { name: 'date', native, filters: { ...filters, endDate: '2026-09-30T00:00:00Z' } },
      { name: 'sort', native, filters: { ...filters, sortBy: 'oldest' as const } },
      { name: 'account', native: { ...native, accountId: 'another-account' }, filters },
    ])(
      'rejects a cursor replayed after changing $name while the fresh search remains valid',
      async (changed) => {
        const first = await searchLiveKnowledge.execute({
          principal,
          input: { ...input, topK: 1, filters, nativeQueries: [native] },
        })
        const cursor = first.live?.accounts[0]?.nextCursor
        expect(cursor).toBeTruthy()
        const fresh = await searchLiveKnowledge.execute({
          principal,
          input: { ...input, topK: 1, filters: changed.filters, nativeQueries: [changed.native] },
        })
        expect(fresh.results).toHaveLength(1)
        const replay = await searchLiveKnowledge.execute({
          principal,
          input: {
            ...input,
            topK: 1,
            filters: changed.filters,
            nativeQueries: [{ ...changed.native, cursor }],
          },
        })
        expect(replay.results).toEqual([])
        expect(replay.live?.accounts[0]).toMatchObject({
          status: 'unavailable',
          message: expect.stringMatching(/cursor|continuation|restart/i),
        })
      }
    )
    it.each([
      'remove implicit cutoff',
      'edit implicit cutoff',
      'override explicit cutoff',
    ] as const)('rejects a continuation that would %s', async (mode) => {
      const query = mode === 'override explicit cutoff' ? 'launch' : ''
      const searchInput = {
        ...input,
        query,
        topK: 1,
        filters: mode === 'override explicit cutoff' ? filters : { sortBy: 'newest' as const },
        nativeQueries: [{ ...native, query }],
      }
      const first = await searchLiveKnowledge.execute({ principal, input: searchInput })
      expect(first.results).toHaveLength(1)
      const cursor = first.live?.accounts[0]?.nextCursor
      expect(cursor).toBeTruthy()
      const payload = JSON.parse(Buffer.from(cursor!.slice(8), 'base64url').toString('utf8'))
      if (mode === 'remove implicit cutoff') payload.listingEndDate = undefined
      else payload.listingEndDate = '2026-11-01T00:00:00Z'
      const altered = `hubspot:${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
      const result = await searchLiveKnowledge.execute({
        principal,
        input: { ...searchInput, nativeQueries: [{ ...native, query, cursor: altered }] },
      })
      expect(result.results).toEqual([])
      expect(result.live?.accounts[0]).toMatchObject({ status: 'unavailable' })
    })
    it.each(['provider window', 'local date filtering'] as const)(
      'keeps the original implicit listing boundary after time advances: %s',
      async (stage) => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
          vi.setSystemTime(new Date('2026-09-01T12:00:00Z'))
          const old = row(43, '2026-09-01T11:30:00Z')
          const later = row(44, '2026-09-01T12:30:00Z')
          mocks.mcpCall.mockImplementation(async (name: string, args: Record<string, unknown>) => {
            if (name === 'get_user_details') return details
            if (name !== 'search_crm_objects') throw new Error('Unexpected CRM tool')
            if (!args.offset) return response(args, [row(42, '2026-09-01T11:45:00Z')], 3)
            if (stage === 'local date filtering') return response(args, [old, later], 3)
            const groups = args.filterGroups as { filters: { operator: string; value: string }[] }[]
            const upper = Number(
              groups[0].filters.find((filter) => filter.operator === 'LT')?.value
            )
            return response(args, [upper <= Date.parse('2026-09-01T12:00:00Z') ? old : later], 2)
          })
          const listing = {
            ...input,
            query: '',
            topK: 1,
            filters: { sortBy: 'newest' as const },
            nativeQueries: [{ ...native, query: '' }],
          }
          const first = await searchLiveKnowledge.execute({ principal, input: listing })
          const cursor = first.live?.accounts[0]?.nextCursor
          expect(first.results).toHaveLength(1)
          expect(cursor).toBeTruthy()
          vi.setSystemTime(new Date('2026-09-01T13:00:00Z'))
          const continued = await searchLiveKnowledge.execute({
            principal,
            input: { ...listing, topK: 2, nativeQueries: [{ ...native, query: '', cursor }] },
          })
          expect(
            continued.results.map((result) => decodeLiveReference(result.documentId).id)
          ).toEqual(['hubspot:12345:contacts:43'])
          expect(continued.live?.accounts[0]?.status).not.toBe('unavailable')
        } finally {
          vi.useRealTimers()
        }
      }
    )
  })
  it('rejects an empty Lucid native query without an explicit browse mode', async () => {
    await expect(
      searchLiveKnowledge.execute({
        principal,
        input: {
          ...input,
          query: 'topology',
          filters: { startDate: '2026-08-01T00:00:00Z' },
          nativeQueries: [{ provider: 'lucid', query: ' \t ' }],
        },
      })
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: [0, 'query'] })]),
    })
  })
  it.each([undefined, 'google_drive'])(
    'preserves date-only live results with source %s',
    async (source) => {
      const result = await searchLiveKnowledge.execute({
        principal,
        input: { ...input, query: '', filters: { source, startDate: '2026-08-01T00:00:00Z' } },
      })
      expect(result.results.map((row) => decodeLiveReference(row.documentId).id)).toEqual(['doc'])
      expect(result.live?.accounts[0]?.status).toBe('ok')
    }
  )
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
  it('suppresses conversation content when a sibling leaves the current service source', async () => {
    const gmail = { ...account, provider: 'gmail', providerId: 'gmail', displayName: 'Mail' }
    mocks.accounts.mockResolvedValue([gmail])
    mocks.resolveAccount.mockResolvedValue({ account: gmail, accessToken: 'secret' })
    const search = await searchLiveKnowledge.execute({ principal, input })
    mocks.read.mockResolvedValue({
      ...document,
      content: 'Anchor evidence. Restricted sibling evidence.',
      accessDependencies: [{ id: 'sibling' }],
    })
    mocks.service.mockResolvedValueOnce({
      policy: defaultLiveSearchPolicy('gmail'),
      verify: async () => true,
      partial: false,
    })
    mocks.service.mockResolvedValueOnce({
      policy: defaultLiveSearchPolicy('gmail'),
      verify: async ({ id }: { id: string }) => id !== 'sibling',
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
  })
  it('ignores stale message labels when rechecking member access after a read', async () => {
    const gmail = { ...account, provider: 'gmail', providerId: 'gmail', displayName: 'Mail' }
    mocks.accounts.mockResolvedValue([gmail])
    mocks.resolveAccount.mockResolvedValue({ account: gmail, accessToken: 'secret' })
    const search = await searchLiveKnowledge.execute({ principal, input })
    vi.mocked(livePolicyFor).mockReturnValue({
      ...defaultLiveSearchPolicy('gmail'),
      mode: 'selected',
      included: ['INBOX'],
    })
    let readCompleted = false
    mocks.json.mockImplementation(async (path: string) => {
      if (path === '/gmail/v1/users/me/labels') return { labels: [{ id: 'INBOX', name: 'INBOX' }] }
      if (path === '/gmail/v1/users/me/messages/doc')
        return { id: 'doc', labelIds: readCompleted ? ['SENT'] : ['INBOX'] }
      throw new Error(`Unexpected Gmail resource: ${path}`)
    })
    mocks.read.mockImplementation(async () => {
      readCompleted = true
      return { ...document, accessMetadata: { id: 'doc', labelIds: ['INBOX'] } }
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
  it.each([
    ['a stop reason', 'user_stop:test'],
    ['an AbortError', new DOMException('The operation was aborted.', 'AbortError')],
    ['a TimeoutError', new DOMException('The operation timed out.', 'TimeoutError')],
  ])(
    'rejects a read cancelled with %s instead of returning partial discussion coverage',
    async (_, reason) => {
      const search = await searchLiveKnowledge.execute({ principal, input })
      const controller = new AbortController()
      mocks.read.mockImplementation((_provider, client) => readDrive(client, 'doc'))
      mocks.json.mockImplementation(async (path: string) => {
        if (!path.endsWith('/comments'))
          return {
            id: 'doc',
            name: 'Launch',
            mimeType: 'application/vnd.google-apps.document',
            webViewLink: document.url,
          }
        controller.abort(reason)
        throw controller.signal.reason
      })
      await expect(
        readLiveDocument.execute({
          principal,
          input: {
            workspaceId: 'workspace',
            documentId: search.results[0]!.documentId,
            limit: 1,
            resultSecretRegistry: new ResolvedSecretTraceRegistry([]),
            signal: controller.signal,
          },
        })
      ).rejects.toBe(reason)
    }
  )
  it('rejects a read cancelled while its current scope was being verified', async () => {
    const search = await searchLiveKnowledge.execute({ principal, input })
    const controller = new AbortController()
    mocks.service.mockResolvedValueOnce(undefined)
    mocks.service.mockImplementationOnce(async () => {
      controller.abort('user_stop:test')
      return { policy: defaultLiveSearchPolicy(), verify: async () => true, partial: false }
    })
    await expect(
      readLiveDocument.execute({
        principal,
        input: {
          workspaceId: 'workspace',
          documentId: search.results[0]!.documentId,
          limit: 1,
          resultSecretRegistry: new ResolvedSecretTraceRegistry([]),
          signal: controller.signal,
        },
      })
    ).rejects.toBe('user_stop:test')
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
        { json: mocks.json, text: vi.fn(), bytes: vi.fn() },
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
