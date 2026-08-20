/**
 * @vitest-environment node
 */
import { authOAuthUtilsMock } from '@sim/testing'
import { generateShortId } from '@sim/utils/id'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  classifySuspectListing,
  evaluateListingSafety,
  isStuckDocumentSweepEligible,
  mergeHydratedDocument,
  type PreviousListingObservation,
} from '@/lib/knowledge/connectors/sync-engine'
import type { ExternalDocument } from '@/connectors/types'

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
vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)
vi.mock('@/background/knowledge-connector-sync', () => ({
  knowledgeConnectorSync: { trigger: vi.fn() },
}))

const { mockMapTags } = vi.hoisted(() => ({ mockMapTags: vi.fn() }))

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

describe('classifySuspectListing', () => {
  it('trusts a healthy listing', () => {
    expect(classifySuspectListing(100, 100)).toBeNull()
    expect(classifySuspectListing(90, 100)).toBeNull()
  })

  it('flags an empty listing against a real corpus', () => {
    expect(classifySuspectListing(0, 3)).toBe('empty')
    expect(classifySuspectListing(0, 10_000)).toBe('empty')
  })

  it('ignores an empty listing on a trivially small corpus', () => {
    expect(classifySuspectListing(0, 0)).toBeNull()
    expect(classifySuspectListing(0, 2)).toBeNull()
  })

  it('flags a near-total collapse on a large corpus', () => {
    expect(classifySuspectListing(3, 10_000)).toBe('collapsed')
    expect(classifySuspectListing(49, 500)).toBe('collapsed')
  })

  it('allows an ordinary bulk deletion through', () => {
    expect(classifySuspectListing(1000, 10_000)).toBeNull()
    expect(classifySuspectListing(1, 8)).toBeNull()
    expect(classifySuspectListing(4, 49)).toBeNull()
  })
})

describe('evaluateListingSafety', () => {
  const previous = (
    listedCount: number,
    ownedCount: number,
    trustworthy = true
  ): PreviousListingObservation => ({ listedCount, ownedCount, trustworthy })

  it('leaves a healthy listing untouched', () => {
    expect(evaluateListingSafety(100, 100, null, undefined)).toEqual({
      reason: null,
      blocked: false,
      corroborated: false,
    })
  })

  it('blocks the first suspect empty listing', () => {
    expect(evaluateListingSafety(0, 500, previous(500, 500), undefined)).toEqual({
      reason: 'empty',
      blocked: true,
      corroborated: false,
    })
  })

  it('blocks when there is no previous completed sync to corroborate', () => {
    expect(evaluateListingSafety(0, 500, null, undefined).blocked).toBe(true)
  })

  it('reconciles once a consecutive sync sees the same empty listing', () => {
    expect(evaluateListingSafety(0, 500, previous(0, 500), undefined)).toEqual({
      reason: 'empty',
      blocked: false,
      corroborated: true,
    })
  })

  it('refuses to be corroborated by a possibly-incremental previous run', () => {
    expect(evaluateListingSafety(0, 500, previous(0, 500, false), undefined).blocked).toBe(true)
  })

  it('blocks then allows a proportional collapse across two syncs', () => {
    expect(evaluateListingSafety(3, 10_000, previous(10_000, 10_000), undefined).blocked).toBe(true)
    expect(evaluateListingSafety(3, 10_000, previous(2, 10_000), undefined)).toEqual({
      reason: 'collapsed',
      blocked: false,
      corroborated: true,
    })
  })

  it('lets an explicit fullSync override the guard', () => {
    expect(evaluateListingSafety(0, 500, null, true)).toEqual({
      reason: 'empty',
      blocked: false,
      corroborated: false,
    })
  })
})

describe('mergeHydratedDocument', () => {
  const stub = (): ExternalDocument => ({
    externalId: 'file-1',
    title: 'Report.pdf',
    content: '',
    mimeType: 'text/plain',
    contentHash: 'sharepoint:file-1:v1',
    contentDeferred: true,
    metadata: { fileSize: 2_400_000 },
  })

  /**
   * A stub is built during listing, before the file is fetched, so it declares
   * `text/plain` for everything. Leaving that behind makes a hydrated PDF keep
   * claiming plain text — invisible while storage reads `sourceFile.mimeType`,
   * and a trap for anything that reaches for the obvious field instead.
   */
  it('carries the hydrated MIME type over the stub placeholder', () => {
    const merged = mergeHydratedDocument(
      stub(),
      {
        ...stub(),
        content: '',
        mimeType: 'application/pdf',
        sourceFile: {
          bytes: Buffer.from('%PDF'),
          fileName: 'Report.pdf',
          mimeType: 'application/pdf',
        },
      },
      'sharepoint:file-1:v2'
    )

    expect(merged.mimeType).toBe('application/pdf')
    expect(merged.sourceFile?.mimeType).toBe('application/pdf')
  })

  it('carries the source file and clears the deferred flag', () => {
    const merged = mergeHydratedDocument(
      stub(),
      { ...stub(), sourceFile: { bytes: Buffer.from('x'), fileName: 'a.pdf', mimeType: 'a/b' } },
      'h'
    )

    expect(merged.sourceFile?.bytes.toString()).toBe('x')
    expect(merged.contentDeferred).toBe(false)
    expect(merged.contentHash).toBe('h')
  })

  it('keeps text-path content and merges metadata over the stub', () => {
    const merged = mergeHydratedDocument(
      stub(),
      { ...stub(), content: 'plain notes', metadata: { createdBy: 'A' } },
      'h'
    )

    expect(merged.content).toBe('plain notes')
    expect(merged.sourceFile).toBeUndefined()
    expect(merged.metadata).toEqual({ fileSize: 2_400_000, createdBy: 'A' })
  })

  it('falls back to the stub title and sourceUrl when hydration omits them', () => {
    const merged = mergeHydratedDocument(
      { ...stub(), sourceUrl: 'https://example.com/a' },
      { ...stub(), title: '', content: 'x' },
      'h'
    )

    expect(merged.title).toBe('Report.pdf')
    expect(merged.sourceUrl).toBe('https://example.com/a')
  })
})

describe('isStuckDocumentSweepEligible', () => {
  const now = new Date('2026-08-20T12:00:00.000Z')
  const minutesBefore = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000)

  const candidate = (
    processingStatus: string,
    overrides: {
      processingQueuedAt?: Date | null
      processingStartedAt?: Date | null
      processingCompletedAt?: Date | null
      uploadedAt?: Date
    } = {}
  ) => ({
    processingStatus,
    processingQueuedAt: overrides.processingQueuedAt ?? null,
    processingStartedAt: overrides.processingStartedAt ?? null,
    processingCompletedAt: overrides.processingCompletedAt ?? null,
    uploadedAt: overrides.uploadedAt ?? minutesBefore(5),
  })

  /**
   * Pinned to the derivation in sync-engine (corpus 7,730 / concurrency 20 x
   * 1 minute occupancy x 2 contention). A change to any input should fail here
   * so it is re-checked deliberately rather than absorbed silently.
   */
  const GRACE_MINUTES = 773

  it('leaves a document dispatched by the previous sync and still queued alone', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', { uploadedAt: minutesBefore(GRACE_MINUTES - 1) }),
        now
      )
    ).toBe(false)
  })

  it('leaves a document the sweep itself re-dispatched alone while it waits', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', {
          processingQueuedAt: minutesBefore(GRACE_MINUTES - 1),
          uploadedAt: minutesBefore(60 * 48),
        }),
        now
      )
    ).toBe(false)
  })

  it('reclaims a queued document once the grace period has passed', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', { uploadedAt: minutesBefore(GRACE_MINUTES + 1) }),
        now
      )
    ).toBe(true)
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', {
          processingQueuedAt: minutesBefore(GRACE_MINUTES + 1),
          uploadedAt: minutesBefore(60 * 48),
        }),
        now
      )
    ).toBe(true)
  })

  it('holds a queued document at the grace boundary', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', { uploadedAt: minutesBefore(GRACE_MINUTES) }),
        now
      )
    ).toBe(false)
  })

  it('leaves a failed document alone while its Trigger retries may still run', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('failed', { processingCompletedAt: minutesBefore(1) }),
        now
      )
    ).toBe(false)
  })

  it('ages a failed document from its last attempt, not from its dispatch', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('failed', {
          processingQueuedAt: minutesBefore(60 * 48),
          processingCompletedAt: minutesBefore(1),
          uploadedAt: minutesBefore(60 * 72),
        }),
        now
      )
    ).toBe(false)
  })

  it('reclaims a failed document once no retry of it can still be live', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('failed', { processingCompletedAt: minutesBefore(GRACE_MINUTES + 1) }),
        now
      )
    ).toBe(true)
  })

  it('holds a failed document at the grace boundary', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('failed', { processingCompletedAt: minutesBefore(GRACE_MINUTES) }),
        now
      )
    ).toBe(false)
  })

  it('falls back to the dispatch stamp when a failed row never recorded completion', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('failed', { processingQueuedAt: minutesBefore(1), uploadedAt: minutesBefore(1) }),
        now
      )
    ).toBe(false)
    expect(
      isStuckDocumentSweepEligible(
        candidate('failed', { processingQueuedAt: minutesBefore(GRACE_MINUTES + 1) }),
        now
      )
    ).toBe(true)
  })

  it('reclaims a processing document only once its run is stale', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('processing', { processingStartedAt: minutesBefore(44) }),
        now
      )
    ).toBe(false)
    expect(
      isStuckDocumentSweepEligible(
        candidate('processing', { processingStartedAt: minutesBefore(46) }),
        now
      )
    ).toBe(true)
  })

  it('reclaims a processing document with no start time', () => {
    expect(isStuckDocumentSweepEligible(candidate('processing'), now)).toBe(true)
  })

  it('ignores a start time a worker left on a document that was requeued', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', {
          processingQueuedAt: minutesBefore(GRACE_MINUTES - 1),
          processingStartedAt: minutesBefore(60 * 48),
          uploadedAt: minutesBefore(60 * 72),
        }),
        now
      )
    ).toBe(false)
  })

  it('gives a document whose content was just updated the full grace period', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', {
          processingQueuedAt: null,
          processingStartedAt: minutesBefore(60 * 48),
          uploadedAt: minutesBefore(5),
        }),
        now
      )
    ).toBe(false)
  })

  it('never reclaims a completed document', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('completed', { uploadedAt: minutesBefore(60 * 48) }),
        now
      )
    ).toBe(false)
  })
})

describe('resolveReconciliationDeleteCap', () => {
  it('scales with the owned corpus above the absolute floor', async () => {
    const { resolveReconciliationDeleteCap } = await import(
      '@/lib/knowledge/connectors/sync-engine'
    )

    expect(resolveReconciliationDeleteCap(1000)).toBe(250)
    expect(resolveReconciliationDeleteCap(400)).toBe(100)
    expect(resolveReconciliationDeleteCap(401)).toBe(100)
  })

  it('never drops below the absolute floor on a small corpus', async () => {
    const { resolveReconciliationDeleteCap } = await import(
      '@/lib/knowledge/connectors/sync-engine'
    )

    expect(resolveReconciliationDeleteCap(0)).toBe(25)
    expect(resolveReconciliationDeleteCap(4)).toBe(25)
    expect(resolveReconciliationDeleteCap(40)).toBe(25)
    expect(resolveReconciliationDeleteCap(100)).toBe(25)
  })

  it('honours an override that raises or lowers the cap', async () => {
    const { resolveReconciliationDeleteCap } = await import(
      '@/lib/knowledge/connectors/sync-engine'
    )

    expect(resolveReconciliationDeleteCap(1000, { maxRatio: 0.9 })).toBe(900)
    expect(resolveReconciliationDeleteCap(1000, { maxRatio: 0.01, minAbsolute: 0 })).toBe(10)
    expect(resolveReconciliationDeleteCap(10, { minAbsolute: 1, maxRatio: 0.25 })).toBe(2)
  })
})

describe('capReconciliationDeletions', () => {
  const ids = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, i) => `${prefix}-${i}`)

  it('passes a request exactly at the cap through untouched', async () => {
    const { capReconciliationDeletions } = await import('@/lib/knowledge/connectors/sync-engine')

    const soft = ids('soft', 250)
    const result = capReconciliationDeletions(soft, [], 1000, false)

    expect(result.held).toBe(false)
    expect(result.cap).toBe(250)
    expect(result.requested).toBe(250)
    expect(result.softDeleteIds).toEqual(soft)
  })

  it('holds a request one document over the cap', async () => {
    const { capReconciliationDeletions } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = capReconciliationDeletions(ids('soft', 251), [], 1000, false)

    expect(result.held).toBe(true)
    expect(result.requested).toBe(251)
  })

  it('returns empty arrays — not the inputs — when held', async () => {
    const { capReconciliationDeletions } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = capReconciliationDeletions(ids('soft', 300), ids('hard', 300), 1000, false)

    expect(result.held).toBe(true)
    expect(result.softDeleteIds).toEqual([])
    expect(result.hardDeleteIds).toEqual([])
  })

  it('counts the union of soft and hard deletions against one cap', async () => {
    const { capReconciliationDeletions } = await import('@/lib/knowledge/connectors/sync-engine')

    const overlapping = ids('doc', 200)
    // Same ids on both lists must count once, not twice.
    expect(capReconciliationDeletions(overlapping, overlapping, 1000, false).held).toBe(false)
    expect(capReconciliationDeletions(ids('a', 200), ids('b', 200), 1000, false).held).toBe(true)
  })

  it('is bypassed by a forced fullSync', async () => {
    const { capReconciliationDeletions } = await import('@/lib/knowledge/connectors/sync-engine')

    const hard = ids('hard', 1000)
    const result = capReconciliationDeletions([], hard, 1000, true)

    expect(result.held).toBe(false)
    expect(result.hardDeleteIds).toEqual(hard)
  })

  it('applies the small-corpus floor rather than the ratio', async () => {
    const { capReconciliationDeletions } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(capReconciliationDeletions(ids('soft', 25), [], 8, false).held).toBe(false)
    expect(capReconciliationDeletions(ids('soft', 26), [], 8, false).held).toBe(true)
  })

  it('honours an override that raises or lowers the cap', async () => {
    const { capReconciliationDeletions } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(capReconciliationDeletions(ids('s', 400), [], 1000, false, { maxRatio: 0.5 }).held).toBe(
      false
    )
    expect(
      capReconciliationDeletions(ids('s', 30), [], 1000, false, {
        maxRatio: 0.01,
        minAbsolute: 5,
      }).held
    ).toBe(true)
  })

  describe('confirmed data-loss shapes', () => {
    it('holds a partial outage that returns half a 1000-document corpus', async () => {
      const { capReconciliationDeletions } = await import('@/lib/knowledge/connectors/sync-engine')

      const result = capReconciliationDeletions(ids('missing', 500), [], 1000, false)

      expect(result.held).toBe(true)
      expect(result.softDeleteIds).toEqual([])
      expect(result.hardDeleteIds).toEqual([])
    })

    it('holds an externalId derivation change that orphans the whole corpus', async () => {
      const { capReconciliationDeletions } = await import('@/lib/knowledge/connectors/sync-engine')

      const result = capReconciliationDeletions(ids('old-key', 1000), [], 1000, false)

      expect(result.held).toBe(true)
      expect(result.softDeleteIds).toEqual([])
      expect(result.hardDeleteIds).toEqual([])
    })
  })
})

describe('resolvePreviousOwnedCount', () => {
  it('falls back to the current owned count when the recorded count collapsed', async () => {
    const { resolvePreviousOwnedCount } = await import('@/lib/knowledge/connectors/sync-engine')

    // lastSyncDocCount excludes tombstones, so a soft-delete pass drives it to 0.
    expect(resolvePreviousOwnedCount(0, 500)).toBe(500)
    expect(resolvePreviousOwnedCount(null, 500)).toBe(500)
    expect(resolvePreviousOwnedCount(undefined, 500)).toBe(500)
  })

  it('keeps the recorded count when it is the larger observation', async () => {
    const { resolvePreviousOwnedCount } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(resolvePreviousOwnedCount(800, 500)).toBe(800)
    expect(resolvePreviousOwnedCount(500, 500)).toBe(500)
  })
})

describe('partitionSyncReconciliation — user-excluded documents', () => {
  const doc = (id: string) => ({ id, externalId: id })
  const excluded = (id: string) => ({ id, externalId: id, userExcluded: true })
  const noFailures = new Set<string>()

  it('never hard-deletes an excluded document that is already pending removal', async () => {
    const { partitionSyncReconciliation } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = partitionSyncReconciliation(
      [],
      [excluded('kept'), doc('gone')],
      new Set(),
      noFailures,
      undefined
    )

    expect(result.hardDeleteIds).toEqual(['gone'])
    expect(result.hardDeleteIds).not.toContain('kept')
  })

  it('still resurrects an excluded pending-removal document that reappears', async () => {
    const { partitionSyncReconciliation } = await import('@/lib/knowledge/connectors/sync-engine')

    /**
     * The assertion that rejects the select-level filter. Dropping excluded rows
     * from the tombstoned read would strand this document permanently: the
     * connector-document listing and the restore mutation both require
     * `deletedAt IS NULL`, so resurrection is its only route back.
     */
    const result = partitionSyncReconciliation(
      [],
      [excluded('kept')],
      new Set(['kept']),
      noFailures,
      undefined
    )

    expect(result.resurrectIds).toEqual(['kept'])
    expect(result.hardDeleteIds).toEqual([])
  })

  it('never soft-deletes an excluded live document absent from the listing', async () => {
    const { partitionSyncReconciliation } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = partitionSyncReconciliation(
      [excluded('kept'), doc('gone')],
      [],
      new Set(),
      noFailures,
      undefined
    )

    expect(result.softDeleteIds).toEqual(['gone'])
  })

  it('exempts excluded documents from a forced fullSync purge too', async () => {
    const { partitionSyncReconciliation } = await import('@/lib/knowledge/connectors/sync-engine')

    const result = partitionSyncReconciliation(
      [excluded('kept-live'), doc('gone-live')],
      [excluded('kept-tombstoned'), doc('gone-tombstoned')],
      new Set(),
      noFailures,
      true
    )

    expect(result.hardDeleteIds).toEqual(['gone-live', 'gone-tombstoned'])
  })
})

describe('countNonExcludedListed', () => {
  it('subtracts the excluded documents that appeared in the listing', async () => {
    const { countNonExcludedListed } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(countNonExcludedListed(new Set(['a', 'b', 'c']), new Set(['b']))).toBe(2)
    expect(countNonExcludedListed(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(0)
  })

  it('ignores excluded documents that were not listed', async () => {
    const { countNonExcludedListed } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(countNonExcludedListed(new Set(['a']), new Set(['x', 'y', 'z']))).toBe(1)
    expect(countNonExcludedListed(new Set(), new Set(['x']))).toBe(0)
  })

  it('keeps the suspect-listing ratio on one population', async () => {
    const { classifySuspectListing, countNonExcludedListed } = await import(
      '@/lib/knowledge/connectors/sync-engine'
    )

    /**
     * The shape the asymmetry hid: a connector owning 1,000 documents of which
     * 200 are user-excluded, whose source returns 90 — 20 of them excluded.
     * The denominator counts only the 800 non-excluded owned documents, so
     * comparing the raw listed count (90) against it misses the collapse,
     * while the symmetric count (70) catches it.
     */
    const ownedDocCount = 800
    const listed = new Set(Array.from({ length: 90 }, (_, i) => `ext-${i}`))
    const excludedExternalIds = new Set(Array.from({ length: 20 }, (_, i) => `ext-${i}`))

    const listedDocCount = countNonExcludedListed(listed, excludedExternalIds)

    expect(listedDocCount).toBe(70)
    expect(classifySuspectListing(listedDocCount, ownedDocCount)).toBe('collapsed')
    // The asymmetric numerator this replaced sees a healthy listing.
    expect(classifySuspectListing(listed.size, ownedDocCount)).toBeNull()
  })
})
