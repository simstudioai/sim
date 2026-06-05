/**
 * @vitest-environment node
 */
import { authOAuthUtilsMock, urlsMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({ db: {} }))
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

vi.mock('@/connectors/registry', () => ({
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
