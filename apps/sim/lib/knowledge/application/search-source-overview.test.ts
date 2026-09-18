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

const principal = { kind: 'session', userId: 'reader', sessionId: 'session' } as const
const input = { organizationId: 'org-1', workspaceId: null }

/** Authorization reads the caller's membership with its own single-row bound, before any probe. */
const AUTHORIZATION_SINGLE_ROW_READS = 1

/** Every other single-row read in this use case is the searchable existence probe. */
const searchableProbeCount = () =>
  dbChainMockFns.limit.mock.calls.filter(([rows]) => rows === 1).length -
  AUTHORIZATION_SINGLE_ROW_READS

function yieldBatches(count: number) {
  mocks.batches.mockImplementation(async function* () {
    for (let index = 0; index < count; index += 1) yield sql`batch-${sql.raw(String(index))}`
  })
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
})
