/** @vitest-environment node */
import { document, knowledgeConnector, member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  availability: vi.fn(),
  provider: vi.fn(),
  batches: vi.fn(),
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOwnerContext: mocks.context,
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  resolveKnowledgeAccessAvailability: mocks.availability,
}))
vi.mock('@/lib/knowledge/access/scope', () => ({
  createKnowledgeAccessProvider: mocks.provider,
}))
vi.mock('@/lib/knowledge/read-access', () => ({
  knowledgeReadAccessBatches: mocks.batches,
}))

import { readSearchSourceOverview } from '@/lib/knowledge/application/search-source-overview'
import { MAX_SEARCH_SOURCE_PROVIDER_TYPES } from '@/lib/knowledge/constants'

const principal = { kind: 'session', userId: 'reader', sessionId: 'session' } as const
const input = { organizationId: 'org-1', workspaceId: null }

/** Authorization reads the caller's membership with its own single-row bound, before any probe. */
const AUTHORIZATION_SINGLE_ROW_READS = 1

/** Every other single-row read in this use case is the searchable existence probe. */
const searchableProbeCount = () =>
  dbChainMockFns.limit.mock.calls.filter(([rows]) => rows === 1).length -
  AUTHORIZATION_SINGLE_ROW_READS

/** The configured-provider list is read once, before the batches, under the same bound. */
const CONFIGURED_PROVIDER_READS = 1

/** Every other provider-bounded read in this use case is the indexing probe. */
const indexingProbeCount = () =>
  dbChainMockFns.limit.mock.calls.filter(([rows]) => rows === MAX_SEARCH_SOURCE_PROVIDER_TYPES)
    .length - CONFIGURED_PROVIDER_READS

/** Counted at the yield, so batches the use case never asks for stay uncounted. */
function yieldBatches(count: number) {
  const consumed = { batches: 0 }
  mocks.batches.mockImplementation(async function* () {
    for (let index = 0; index < count; index += 1) {
      consumed.batches += 1
      yield sql`batch-${sql.raw(String(index))}`
    }
  })
  return consumed
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.context.mockResolvedValue(input)
  mocks.availability.mockResolvedValue({ memberScoped: true, sourceMirrored: false })
  mocks.provider.mockReturnValue({ get: async () => ({ kind: 'user' }) })
})

describe('readSearchSourceOverview', () => {
  it('stops probing for a searchable document once one batch has found one', async () => {
    yieldBatches(3)
    queueTableRows(member, [{ role: 'owner' }])
    queueTableRows(knowledgeConnector, [{ connectorType: 'gmail' }])
    queueTableRows(document, [{ id: 'doc-1' }])

    const result = await readSearchSourceOverview.execute({ principal, input })

    expect(result.hasSearchableDocuments).toBe(true)
    expect(searchableProbeCount()).toBe(1)
  })

  it('keeps probing every batch while no searchable document has been found', async () => {
    yieldBatches(3)
    queueTableRows(member, [{ role: 'owner' }])
    queueTableRows(knowledgeConnector, [{ connectorType: 'gmail' }])

    const result = await readSearchSourceOverview.execute({ principal, input })

    expect(result.hasSearchableDocuments).toBe(false)
    expect(searchableProbeCount()).toBe(3)
  })

  it('stops probing for indexing once every configured provider type is known', async () => {
    const consumed = yieldBatches(3)
    queueTableRows(member, [{ role: 'owner' }])
    queueTableRows(knowledgeConnector, [{ connectorType: 'gmail' }])
    queueTableRows(knowledgeConnector, [{ connectorType: 'gmail' }])

    const result = await readSearchSourceOverview.execute({ principal, input })

    expect(result).toEqual({
      providers: [{ connectorType: 'gmail', isSyncing: true }],
      hasSearchableDocuments: false,
    })
    expect(indexingProbeCount()).toBe(1)
    /** The searchable probe is still unsatisfied, so the batches keep being consumed. */
    expect(consumed.batches).toBe(3)
  })

  it('keeps probing every batch while a configured provider type is still unaccounted for', async () => {
    yieldBatches(3)
    queueTableRows(member, [{ role: 'owner' }])
    queueTableRows(knowledgeConnector, [{ connectorType: 'gmail' }, { connectorType: 'notion' }])
    queueTableRows(knowledgeConnector, [{ connectorType: 'gmail' }])

    const result = await readSearchSourceOverview.execute({ principal, input })

    expect(result.providers).toEqual([
      { connectorType: 'gmail', isSyncing: true },
      { connectorType: 'notion', isSyncing: false },
    ])
    expect(indexingProbeCount()).toBe(3)
  })

  it('stops consuming access batches once neither probe can change the result', async () => {
    const consumed = yieldBatches(3)
    queueTableRows(member, [{ role: 'owner' }])
    queueTableRows(knowledgeConnector, [{ connectorType: 'gmail' }])
    queueTableRows(knowledgeConnector, [{ connectorType: 'gmail' }])
    queueTableRows(document, [{ id: 'doc-1' }])

    const result = await readSearchSourceOverview.execute({ principal, input })

    expect(result).toEqual({
      providers: [{ connectorType: 'gmail', isSyncing: true }],
      hasSearchableDocuments: true,
    })
    expect(consumed.batches).toBe(1)
  })

  it('keeps consuming access batches for a provider type still unaccounted for', async () => {
    const consumed = yieldBatches(3)
    queueTableRows(member, [{ role: 'owner' }])
    queueTableRows(knowledgeConnector, [{ connectorType: 'gmail' }, { connectorType: 'notion' }])
    queueTableRows(knowledgeConnector, [{ connectorType: 'gmail' }])
    queueTableRows(document, [{ id: 'doc-1' }])

    const result = await readSearchSourceOverview.execute({ principal, input })

    expect(result).toEqual({
      providers: [
        { connectorType: 'gmail', isSyncing: true },
        { connectorType: 'notion', isSyncing: false },
      ],
      hasSearchableDocuments: true,
    })
    expect(consumed.batches).toBe(3)
  })
})
