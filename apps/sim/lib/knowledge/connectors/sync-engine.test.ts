/**
 * @vitest-environment node
 */
import { authOAuthUtilsMock, dbChainMock, urlsMock } from '@sim/testing'
import { generateShortId } from '@sim/utils/id'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  ne: vi.fn(),
}))
vi.mock('@/lib/core/utils/urls', () => urlsMock)
vi.mock('@/lib/knowledge/documents/service', () => ({
  hardDeleteDocuments: vi.fn(),
  isTriggerAvailable: vi.fn(),
  processDocumentAsync: vi.fn(),
}))
vi.mock('@/lib/uploads', () => ({ StorageService: {} }))
vi.mock('@/app/api/auth/oauth/utils', () => authOAuthUtilsMock)
vi.mock('@/background/knowledge-connector-sync', () => ({
  knowledgeConnectorSync: { trigger: vi.fn() },
}))

const mockMapTags = vi.fn()

vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    jira: {
      mapTags: mockMapTags,
    },
    'no-tags': {
      name: 'No Tags',
    },
  },
}))

describe('shouldReconcileDeletions', () => {
  it('runs on a clean full listing', async () => {
    const { shouldReconcileDeletions } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(shouldReconcileDeletions(false, {}, undefined)).toBe(true)
    expect(shouldReconcileDeletions(false, undefined, undefined)).toBe(true)
  })

  it('never runs on incremental syncs', async () => {
    const { shouldReconcileDeletions } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(shouldReconcileDeletions(true, {}, undefined)).toBe(false)
    expect(shouldReconcileDeletions(true, {}, true)).toBe(false)
    expect(shouldReconcileDeletions(true, { listingCapped: true }, true)).toBe(false)
  })

  it('skips when a connector capped the listing', async () => {
    const { shouldReconcileDeletions } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(shouldReconcileDeletions(false, { listingCapped: true }, undefined)).toBe(false)
    expect(shouldReconcileDeletions(false, { listingCapped: true }, false)).toBe(false)
  })

  it('lets a forced fullSync override a connector cap', async () => {
    const { shouldReconcileDeletions } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(shouldReconcileDeletions(false, { listingCapped: true }, true)).toBe(true)
  })

  it('never runs when the engine truncated pagination, even on a forced fullSync', async () => {
    const { shouldReconcileDeletions } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(shouldReconcileDeletions(false, { listingTruncated: true }, undefined)).toBe(false)
    expect(shouldReconcileDeletions(false, { listingTruncated: true }, true)).toBe(false)
    expect(
      shouldReconcileDeletions(false, { listingCapped: true, listingTruncated: true }, true)
    ).toBe(false)
  })
})

describe('resolveTagMapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps semantic keys to DB slots', async () => {
    mockMapTags.mockReturnValue({
      issueType: 'Bug',
      status: 'Open',
      priority: 'High',
    })

    const { resolveTagMapping } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = resolveTagMapping(
      'jira',
      { issueType: 'Bug', status: 'Open', priority: 'High' },
      {
        tagSlotMapping: {
          issueType: 'tag1',
          status: 'tag2',
          priority: 'tag3',
        },
      }
    )

    expect(result).toEqual({
      tag1: 'Bug',
      tag2: 'Open',
      tag3: 'High',
    })
  })

  it('returns undefined when connector has no mapTags', async () => {
    const { resolveTagMapping } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = resolveTagMapping(
      'no-tags',
      { key: 'value' },
      {
        tagSlotMapping: { key: 'tag1' },
      }
    )

    expect(result).toBeUndefined()
  })

  it('returns undefined when connector type is unknown', async () => {
    const { resolveTagMapping } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = resolveTagMapping('unknown', { key: 'value' }, {})

    expect(result).toBeUndefined()
  })

  it('returns undefined when no tagSlotMapping in sourceConfig', async () => {
    mockMapTags.mockReturnValue({ issueType: 'Bug' })

    const { resolveTagMapping } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = resolveTagMapping('jira', { issueType: 'Bug' }, {})

    expect(result).toBeUndefined()
  })

  it('sets null for missing metadata keys', async () => {
    mockMapTags.mockReturnValue({
      issueType: 'Bug',
      status: undefined,
    })

    const { resolveTagMapping } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = resolveTagMapping(
      'jira',
      { issueType: 'Bug' },
      {
        tagSlotMapping: {
          issueType: 'tag1',
          status: 'tag2',
          missing: 'tag3',
        },
      }
    )

    expect(result).toEqual({
      tag1: 'Bug',
      tag2: null,
      tag3: null,
    })
  })

  it('returns undefined when sourceConfig is undefined', async () => {
    mockMapTags.mockReturnValue({ issueType: 'Bug' })

    const { resolveTagMapping } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = resolveTagMapping('jira', { issueType: 'Bug' }, undefined)

    expect(result).toBeUndefined()
  })
})

describe('classifyExternalDoc', () => {
  const base = { content: 'hello', contentDeferred: false, contentHash: 'h1' }

  it('records a new skipped file as a failed row', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-engine')
    expect(
      classifyExternalDoc({ ...base, content: '', skippedReason: 'too big' }, undefined)
    ).toEqual({ type: 'skip' })
  })

  it('keeps an already-indexed file as-is when it becomes skipped (last-known-good)', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-engine')
    expect(
      classifyExternalDoc(
        { ...base, content: '', skippedReason: 'too big' },
        {
          id: 'doc-1',
          contentHash: 'old',
        }
      )
    ).toEqual({ type: 'unchanged' })
  })

  it('drops empty non-deferred content', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-engine')
    expect(classifyExternalDoc({ ...base, content: '   ' }, undefined)).toEqual({ type: 'drop' })
  })

  it('adds new content and deferred stubs', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-engine')
    expect(classifyExternalDoc(base, undefined)).toEqual({ type: 'add' })
    expect(classifyExternalDoc({ ...base, content: '', contentDeferred: true }, undefined)).toEqual(
      { type: 'add' }
    )
  })

  it('updates when the content hash changed and is unchanged otherwise', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-engine')
    expect(classifyExternalDoc(base, { id: 'doc-1', contentHash: 'old' })).toEqual({
      type: 'update',
      existingId: 'doc-1',
    })
    expect(classifyExternalDoc(base, { id: 'doc-1', contentHash: 'h1' })).toEqual({
      type: 'unchanged',
    })
  })

  it('forces re-hydration of an unchanged deferred doc when forceRehydrate is set', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-engine')
    const deferred = { ...base, content: '', contentDeferred: true }
    // Same hash → normally unchanged, but forceRehydrate promotes it to update.
    expect(classifyExternalDoc(deferred, { id: 'doc-1', contentHash: 'h1' }, true)).toEqual({
      type: 'update',
      existingId: 'doc-1',
    })
  })

  it('does not force re-hydration of a non-deferred doc (content already final)', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-engine')
    // Ready (non-deferred) content with an unchanged hash stays unchanged even under forceRehydrate.
    expect(classifyExternalDoc(base, { id: 'doc-1', contentHash: 'h1' }, true)).toEqual({
      type: 'unchanged',
    })
  })
})

describe('chunkOpsByByteBudget', () => {
  const MB = 1024 * 1024
  const addOp = (sizeBytes?: number) => ({
    type: 'add' as const,
    extDoc: {
      externalId: `e-${generateShortId()}`,
      title: 'f',
      content: 'x',
      contentHash: 'h',
      mimeType: 'text/plain',
      ...(sizeBytes != null ? { metadata: { fileSize: sizeBytes } } : {}),
    },
  })
  const skipOp = (sizeBytes: number) => ({
    type: 'skip' as const,
    extDoc: {
      externalId: `s-${generateShortId()}`,
      title: 'f',
      content: '',
      contentHash: 'h',
      mimeType: 'text/plain',
      skippedReason: 'too big',
      metadata: { fileSize: sizeBytes },
    },
  })

  it('batches small ops up to the count cap', async () => {
    const { chunkOpsByByteBudget } = await import('@/lib/knowledge/connectors/sync-engine')
    const chunks = chunkOpsByByteBudget(
      Array.from({ length: 7 }, () => addOp(1024)),
      64 * MB,
      5
    )
    expect(chunks.map((c) => c.length)).toEqual([5, 2])
  })

  it('isolates a file larger than the budget into its own chunk', async () => {
    const { chunkOpsByByteBudget } = await import('@/lib/knowledge/connectors/sync-engine')
    const chunks = chunkOpsByByteBudget([addOp(100 * MB), addOp(1024)], 64 * MB, 5)
    expect(chunks.map((c) => c.length)).toEqual([1, 1])
  })

  it('caps summed bytes per chunk for medium files', async () => {
    const { chunkOpsByByteBudget } = await import('@/lib/knowledge/connectors/sync-engine')
    // 40 + 40 = 80 MB exceeds the 64 MB budget, so they split.
    const chunks = chunkOpsByByteBudget([addOp(40 * MB), addOp(40 * MB)], 64 * MB, 5)
    expect(chunks.map((c) => c.length)).toEqual([1, 1])
  })

  it('treats skip ops as zero bytes so they do not consume the budget', async () => {
    const { chunkOpsByByteBudget } = await import('@/lib/knowledge/connectors/sync-engine')
    const chunks = chunkOpsByByteBudget(
      [skipOp(100 * MB), skipOp(100 * MB), addOp(1024)],
      64 * MB,
      5
    )
    expect(chunks).toHaveLength(1)
  })
})
