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

  it.each([
    ['basic', { knowledgeBaseSelector: null, manualKnowledgeBaseId: 'stale-advanced' }, null],
    ['advanced', { knowledgeBaseSelector: 'stale-basic', manualKnowledgeBaseId: '' }, ''],
  ] as const)(
    'keeps a cleared %s value instead of previewing the dormant mode',
    (mode, clearedValues, expected) => {
      const result = buildPreviewContextValues(clearedValues, {
        blockType: 'knowledge',
        subBlocks: [],
        canonicalIndex,
        values: clearedValues,
        overrides: { knowledgeBaseId: mode },
      })

      expect(result.knowledgeBaseId).toBe(expected)
    }
  )

  it('drops a stale direct canonical parameter when a modern member is explicitly cleared', () => {
    const params = { knowledgeBaseId: 'legacy-direct', knowledgeBaseSelector: null }
    const result = buildPreviewContextValues(params, {
      blockType: 'knowledge',
      subBlocks: [],
      canonicalIndex,
      values: params,
      overrides: { knowledgeBaseId: 'basic' },
    })

    expect(result.knowledgeBaseId).toBeNull()
  })

  it('preserves the legacy direct fallback when no mode has been persisted', () => {
    const params = { knowledgeBaseId: 'legacy-direct', knowledgeBaseSelector: null }
    const result = buildPreviewContextValues(params, {
      blockType: 'knowledge',
      subBlocks: [],
      canonicalIndex,
      values: params,
    })

    expect(result.knowledgeBaseId).toBe('legacy-direct')
  })
})
