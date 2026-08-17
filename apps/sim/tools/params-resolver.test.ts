/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildCanonicalIndex, buildPreviewContextValues } from '@/tools/params-resolver'

const canonicalIndex = buildCanonicalIndex([
  {
    id: 'knowledgeBaseSelector',
    type: 'knowledge-base-selector',
    canonicalParamId: 'knowledgeBaseId',
    mode: 'basic',
  },
  {
    id: 'manualKnowledgeBaseId',
    type: 'short-input',
    canonicalParamId: 'knowledgeBaseId',
    mode: 'advanced',
  },
] as Parameters<typeof buildCanonicalIndex>[0])

const values = { knowledgeBaseSelector: 'kb-basic', manualKnowledgeBaseId: 'kb-advanced' }

describe('buildPreviewContextValues', () => {
  it('honors an explicit advanced override so the preview matches execution', () => {
    const result = buildPreviewContextValues(values, {
      blockType: 'knowledge',
      subBlocks: [],
      canonicalIndex,
      values,
      overrides: { knowledgeBaseId: 'advanced' },
    })
    expect(result.knowledgeBaseId).toBe('kb-advanced')
  })

  it('falls back to the value heuristic (basic when present) without an override', () => {
    const result = buildPreviewContextValues(values, {
      blockType: 'knowledge',
      subBlocks: [],
      canonicalIndex,
      values,
    })
    expect(result.knowledgeBaseId).toBe('kb-basic')
  })

  it('resolves tag filter canonical pairs without leaking the dormant value', () => {
    const tagFilterCanonicalIndex = buildCanonicalIndex([
      {
        id: 'tagFilters',
        type: 'knowledge-tag-filters',
        canonicalParamId: 'tagFilters',
        mode: 'basic',
      },
      {
        id: 'manualTagFilters',
        type: 'knowledge-tag-filters',
        canonicalParamId: 'tagFilters',
        mode: 'advanced',
      },
    ] as Parameters<typeof buildCanonicalIndex>[0])
    const tagFilterValues = {
      tagFilters: '[{"tagName":"Category","tagValue":"docs"}]',
      manualTagFilters: '[{"tagId":"tag-id","tagValue":"docs"}]',
    }

    const basic = buildPreviewContextValues(tagFilterValues, {
      blockType: 'knowledge',
      subBlocks: [],
      canonicalIndex: tagFilterCanonicalIndex,
      values: tagFilterValues,
      overrides: { tagFilters: 'basic' },
    })
    const advanced = buildPreviewContextValues(tagFilterValues, {
      blockType: 'knowledge',
      subBlocks: [],
      canonicalIndex: tagFilterCanonicalIndex,
      values: tagFilterValues,
      overrides: { tagFilters: 'advanced' },
    })

    expect(basic.tagFilters).toBe(tagFilterValues.tagFilters)
    expect(advanced.tagFilters).toBe(tagFilterValues.manualTagFilters)
  })

  it('exposes the scoped advanced knowledge base under its canonical dependency key', () => {
    const knowledgeBaseCanonicalIndex = buildCanonicalIndex([
      {
        id: 'knowledgeBaseSelector',
        type: 'knowledge-base-selector',
        canonicalParamId: 'knowledgeBaseId',
        mode: 'basic',
      },
      {
        id: 'manualKnowledgeBaseId',
        type: 'short-input',
        canonicalParamId: 'knowledgeBaseId',
        mode: 'advanced',
      },
    ] as Parameters<typeof buildCanonicalIndex>[0])
    const values = {
      knowledgeBaseSelector: 'kb-stale-basic',
      manualKnowledgeBaseId: 'kb-active-advanced',
    }

    const context = buildPreviewContextValues(values, {
      blockType: 'knowledge',
      subBlocks: [],
      canonicalIndex: knowledgeBaseCanonicalIndex,
      values,
      overrides: { knowledgeBaseId: 'advanced' },
    })

    expect(context.knowledgeBaseId).toBe('kb-active-advanced')
  })
})
