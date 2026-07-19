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
})
