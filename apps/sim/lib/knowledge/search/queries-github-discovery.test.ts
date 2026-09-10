/** @vitest-environment node */
import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createKnowledgeAccessProvider } from '@/lib/knowledge/access/scope'
import { handleTagOnlySearch } from '@/lib/knowledge/search/queries'

vi.mock('@/lib/knowledge/access/availability', () => ({
  resolveKnowledgeAccessAvailability: async () => ({ memberScoped: true, sourceMirrored: false }),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ checkWorkspaceAccess: vi.fn() }))
vi.mock('@/lib/credentials/managed-oauth', () => ({ resolveManagedOAuthToken: vi.fn() }))
vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: vi.fn() }))
vi.mock('@/lib/oauth/github-installation', () => ({
  parseGitHubInstallationBinding: vi.fn(),
  assertGitHubInstallationActive: vi.fn(),
  assertGitHubInstallationRepositoryActive: vi.fn(),
}))

async function createReaderProvider(hasGitHubReader = true) {
  queueTableRows(schemaMock.member, [{ id: 'membership-1' }])
  queueTableRows(schemaMock.user, [
    {
      credentialId: 'github-reader',
      providerId: hasGitHubReader ? 'github-repositories' : 'gmail',
      providerSubjectId: '42',
      providerTenantId: null,
    },
  ])
  const provider = createKnowledgeAccessProvider(
    { kind: 'session', userId: 'reader', sessionId: 'session-1' },
    { organizationId: 'org-1', knowledgeBaseIds: ['index-1'] }
  )
  const access = await provider.get()
  return { provider, access }
}

describe('GitHub discovery through the request access provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it.each([true, false])(
    'skips discovery for explicit Gmail with GitHub reader present: %s',
    async (hasGitHubReader) => {
      const { provider, access } = await createReaderProvider(hasGitHubReader)
      await provider.getForConnectors(['gmail-source'])
      expect(
        dbChainMockFns.from.mock.calls.filter(([table]) => table === schemaMock.knowledgeConnector)
      ).toHaveLength(hasGitHubReader ? 1 : 0)
      dbChainMockFns.from.mockClear()

      queueTableRows(schemaMock.embedding, [
        {
          id: 'gmail',
          documentId: 'gmail-doc',
          connectorId: 'gmail-source',
          liveAuthorizationSource: false,
        },
      ])
      const hydrated = [{ id: 'gmail', content: 'permitted content' }]
      queueTableRows(schemaMock.embedding, hydrated)

      expect(
        await handleTagOnlySearch({
          knowledgeBaseIds: ['index-1'],
          topK: 1,
          access,
          accessProvider: provider,
          filters: { source: 'gmail' },
          structuredFilters: [
            { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'release' },
          ],
        })
      ).toEqual(hydrated)
      expect(dbChainMockFns.from.mock.calls.map(([table]) => table)).toEqual([
        schemaMock.embedding,
        schemaMock.embedding,
      ])
    }
  )

  it.each([undefined, '', 'github'])(
    'keeps current discovery for classic GitHub with source: %s',
    async (source) => {
      const { provider, access } = await createReaderProvider()
      queueTableRows(schemaMock.embedding, [
        {
          id: 'github',
          documentId: 'github-doc',
          connectorId: 'classic-github',
          liveAuthorizationSource: false,
        },
        {
          id: 'github-second',
          documentId: 'github-doc',
          connectorId: 'classic-github',
          liveAuthorizationSource: false,
        },
      ])
      queueTableRows(schemaMock.embedding, [{ id: 'github', content: 'permitted content' }])

      await handleTagOnlySearch({
        knowledgeBaseIds: ['index-1'],
        topK: 1,
        access,
        accessProvider: provider,
        filters: { source },
        structuredFilters: [
          { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'release' },
        ],
      })
      expect(
        dbChainMockFns.from.mock.calls.filter(([table]) => table === schemaMock.knowledgeConnector)
      ).toHaveLength(1)
      expect(
        dbChainMockFns.where.mock.calls.some(([condition]) =>
          hasMockCondition(
            condition,
            (node) =>
              node.type === 'inArray' &&
              node.column === schemaMock.knowledgeConnector.id &&
              JSON.stringify(node.values) === JSON.stringify(['classic-github'])
          )
        )
      ).toBe(true)
    }
  )

  it('keeps upload hydration without source discovery', async () => {
    const { provider, access } = await createReaderProvider()
    dbChainMockFns.from.mockClear()
    queueTableRows(schemaMock.embedding, [
      { id: 'upload', documentId: 'upload-doc', connectorId: null, liveAuthorizationSource: false },
    ])
    const hydrated = [{ id: 'upload', content: 'permitted content' }]
    queueTableRows(schemaMock.embedding, hydrated)

    expect(
      await handleTagOnlySearch({
        knowledgeBaseIds: ['index-1'],
        topK: 1,
        access,
        accessProvider: provider,
        filters: { source: 'upload' },
        structuredFilters: [
          { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'release' },
        ],
      })
    ).toEqual(hydrated)
    expect(dbChainMockFns.from.mock.calls.map(([table]) => table)).toEqual([
      schemaMock.embedding,
      schemaMock.embedding,
    ])
  })
})
