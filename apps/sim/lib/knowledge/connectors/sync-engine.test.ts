/**
 * @vitest-environment node
 */
import { authOAuthUtilsMock } from '@sim/testing'
import { generateShortId } from '@sim/utils/id'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  ne: vi.fn(),
}))
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

describe('shouldRunIncrementalSync', () => {
  const lastSyncAt = '2026-07-01T00:00:00.000Z'

  it('runs incrementally when everything is eligible', async () => {
    const { shouldRunIncrementalSync } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(
      shouldRunIncrementalSync(true, 'incremental', undefined, undefined, false, lastSyncAt)
    ).toBe(true)
  })

  it('never runs incrementally when the connector does not support it', async () => {
    const { shouldRunIncrementalSync } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(
      shouldRunIncrementalSync(false, 'incremental', undefined, undefined, false, lastSyncAt)
    ).toBe(false)
  })

  it('never runs incrementally when the connector is configured for full syncs', async () => {
    const { shouldRunIncrementalSync } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(shouldRunIncrementalSync(true, 'full', undefined, undefined, false, lastSyncAt)).toBe(
      false
    )
  })

  it('never runs incrementally on a forced fullSync or rehydrate', async () => {
    const { shouldRunIncrementalSync } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(shouldRunIncrementalSync(true, 'incremental', true, undefined, false, lastSyncAt)).toBe(
      false
    )
    expect(shouldRunIncrementalSync(true, 'incremental', undefined, true, false, lastSyncAt)).toBe(
      false
    )
  })

  it('never runs incrementally before the first sync', async () => {
    const { shouldRunIncrementalSync } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(shouldRunIncrementalSync(true, 'incremental', undefined, undefined, false, null)).toBe(
      false
    )
  })

  it('forces a full listing whenever pending-removal documents exist, so they get a resurrect-or-confirm decision', async () => {
    const { shouldRunIncrementalSync } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(
      shouldRunIncrementalSync(true, 'incremental', undefined, undefined, true, lastSyncAt)
    ).toBe(false)
  })
})

describe('partitionSyncReconciliation', () => {
  const live = (id: string, externalId: string | null = id) => ({ id, externalId })
  const noFailures = new Set<string>()

  it('marks a live document missing from the listing as pending removal, not hard-deleted', async () => {
    const { partitionSyncReconciliation } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = partitionSyncReconciliation([live('a')], [], new Set(), noFailures, undefined)

    expect(result).toEqual({ resurrectIds: [], softDeleteIds: ['a'], hardDeleteIds: [] })
  })

  it('hard-deletes a document already pending removal that is still absent', async () => {
    const { partitionSyncReconciliation } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = partitionSyncReconciliation([], [live('a')], new Set(), noFailures, undefined)

    expect(result).toEqual({ resurrectIds: [], softDeleteIds: [], hardDeleteIds: ['a'] })
  })

  it('resurrects a pending-removal document that reappears in the listing', async () => {
    const { partitionSyncReconciliation } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = partitionSyncReconciliation(
      [],
      [live('a')],
      new Set(['a']),
      noFailures,
      undefined
    )

    expect(result).toEqual({ resurrectIds: ['a'], softDeleteIds: [], hardDeleteIds: [] })
  })

  it('leaves a document untouched when it is still present in the listing', async () => {
    const { partitionSyncReconciliation } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = partitionSyncReconciliation(
      [live('a')],
      [],
      new Set(['a']),
      noFailures,
      undefined
    )

    expect(result).toEqual({ resurrectIds: [], softDeleteIds: [], hardDeleteIds: [] })
  })

  it('resurrects even on a forced fullSync', async () => {
    const { partitionSyncReconciliation } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = partitionSyncReconciliation([], [live('a')], new Set(['a']), noFailures, true)

    expect(result.resurrectIds).toEqual(['a'])
  })

  it('hard-deletes both live and pending-removal documents immediately on a forced fullSync', async () => {
    const { partitionSyncReconciliation } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = partitionSyncReconciliation(
      [live('a')],
      [live('b')],
      new Set(),
      noFailures,
      true
    )

    expect(result.softDeleteIds).toEqual([])
    expect(result.hardDeleteIds.sort()).toEqual(['a', 'b'])
  })

  it('handles a mixed batch of every outcome in one pass', async () => {
    const { partitionSyncReconciliation } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = partitionSyncReconciliation(
      [live('kept'), live('newly-missing')],
      [live('resurrected'), live('confirmed-gone')],
      new Set(['kept', 'resurrected']),
      noFailures,
      undefined
    )

    expect(result).toEqual({
      resurrectIds: ['resurrected'],
      softDeleteIds: ['newly-missing'],
      hardDeleteIds: ['confirmed-gone'],
    })
  })

  it('ignores documents with a null externalId', async () => {
    const { partitionSyncReconciliation } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = partitionSyncReconciliation(
      [live('a', null)],
      [live('b', null)],
      new Set(),
      noFailures,
      undefined
    )

    expect(result).toEqual({ resurrectIds: [], softDeleteIds: [], hardDeleteIds: [] })
  })

  it('does not resurrect a reappearing document whose content refresh failed', async () => {
    const { partitionSyncReconciliation } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = partitionSyncReconciliation(
      [],
      [live('a')],
      new Set(['a']),
      new Set(['a']),
      undefined
    )

    expect(result).toEqual({ resurrectIds: [], softDeleteIds: [], hardDeleteIds: [] })
  })

  it('still refuses to resurrect a failed refresh even on a forced fullSync', async () => {
    const { partitionSyncReconciliation } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = partitionSyncReconciliation(
      [],
      [live('a')],
      new Set(['a']),
      new Set(['a']),
      true
    )

    expect(result.resurrectIds).toEqual([])
  })

  it('resurrects the ones that succeeded while excluding the one that failed', async () => {
    const { partitionSyncReconciliation } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = partitionSyncReconciliation(
      [],
      [live('ok'), live('failed')],
      new Set(['ok', 'failed']),
      new Set(['failed']),
      undefined
    )

    expect(result.resurrectIds).toEqual(['ok'])
  })
})

describe('filterStillOwnedReconciliationIds', () => {
  it('keeps ids present in the ownership snapshot', async () => {
    const { filterStillOwnedReconciliationIds } = await import(
      '@/lib/knowledge/connectors/sync-engine'
    )

    const result = filterStillOwnedReconciliationIds(['a'], ['b'], ['c'], new Set(['a', 'b', 'c']))

    expect(result).toEqual({ resurrectIds: ['a'], softDeleteIds: ['b'], hardDeleteIds: ['c'] })
  })

  it('drops ids a concurrent connector-delete already detached', async () => {
    const { filterStillOwnedReconciliationIds } = await import(
      '@/lib/knowledge/connectors/sync-engine'
    )

    const result = filterStillOwnedReconciliationIds(['a'], ['b'], ['c'], new Set(['a']))

    expect(result).toEqual({ resurrectIds: ['a'], softDeleteIds: [], hardDeleteIds: [] })
  })

  it('returns all-empty lists when nothing is still owned', async () => {
    const { filterStillOwnedReconciliationIds } = await import(
      '@/lib/knowledge/connectors/sync-engine'
    )

    const result = filterStillOwnedReconciliationIds(['a'], ['b'], ['c'], new Set())

    expect(result).toEqual({ resurrectIds: [], softDeleteIds: [], hardDeleteIds: [] })
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
