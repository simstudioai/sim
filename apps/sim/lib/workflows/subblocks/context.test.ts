/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { getAllBlocks } from '@/blocks/registry'
import { buildSelectorContextFromBlock, SELECTOR_CONTEXT_FIELDS } from './context'
import { buildCanonicalIndex, isCanonicalPair } from './visibility'

describe('buildSelectorContextFromBlock', () => {
  it('should extract knowledgeBaseId from knowledgeBaseSelector via canonical mapping', () => {
    const ctx = buildSelectorContextFromBlock('knowledge', {
      operation: { id: 'operation', type: 'dropdown', value: 'search' },
      knowledgeBaseSelector: {
        id: 'knowledgeBaseSelector',
        type: 'knowledge-base-selector',
        value: 'kb-uuid-123',
      },
    })

    expect(ctx.knowledgeBaseId).toBe('kb-uuid-123')
  })

  it('should extract knowledgeBaseId from manualKnowledgeBaseId via canonical mapping', () => {
    const ctx = buildSelectorContextFromBlock('knowledge', {
      operation: { id: 'operation', type: 'dropdown', value: 'search' },
      manualKnowledgeBaseId: {
        id: 'manualKnowledgeBaseId',
        type: 'short-input',
        value: 'manual-kb-id',
      },
    })

    expect(ctx.knowledgeBaseId).toBe('manual-kb-id')
  })

  it('should skip null/empty values', () => {
    const ctx = buildSelectorContextFromBlock('knowledge', {
      knowledgeBaseSelector: {
        id: 'knowledgeBaseSelector',
        type: 'knowledge-base-selector',
        value: '',
      },
    })

    expect(ctx.knowledgeBaseId).toBeUndefined()
  })

  it('should return empty context for unknown block types', () => {
    const ctx = buildSelectorContextFromBlock('nonexistent_block', {
      foo: { id: 'foo', type: 'short-input', value: 'bar' },
    })

    expect(ctx).toEqual({})
  })

  it('should pass through workflowId from opts', () => {
    const ctx = buildSelectorContextFromBlock(
      'knowledge',
      { operation: { id: 'operation', type: 'dropdown', value: 'search' } },
      { workflowId: 'wf-123' }
    )

    expect(ctx.workflowId).toBe('wf-123')
  })

  it('should ignore subblock keys not in SELECTOR_CONTEXT_FIELDS', () => {
    const ctx = buildSelectorContextFromBlock('knowledge', {
      operation: { id: 'operation', type: 'dropdown', value: 'search' },
      query: { id: 'query', type: 'short-input', value: 'some search query' },
    })

    expect((ctx as Record<string, unknown>).query).toBeUndefined()
    expect((ctx as Record<string, unknown>).operation).toBeUndefined()
  })
})

describe('SELECTOR_CONTEXT_FIELDS validation', () => {
  it('every entry must be a canonicalParamId (if a canonical pair exists) or a direct subblock ID', () => {
    const allCanonicalParamIds = new Set<string>()
    const allSubBlockIds = new Set<string>()
    const idsInCanonicalPairs = new Set<string>()

    for (const block of getAllBlocks()) {
      const index = buildCanonicalIndex(block.subBlocks)

      for (const sb of block.subBlocks) {
        allSubBlockIds.add(sb.id)
        if (sb.canonicalParamId) {
          allCanonicalParamIds.add(sb.canonicalParamId)
        }
      }

      for (const group of Object.values(index.groupsById)) {
        if (!isCanonicalPair(group)) continue
        if (group.basicId) idsInCanonicalPairs.add(group.basicId)
        for (const advId of group.advancedIds) idsInCanonicalPairs.add(advId)
      }
    }

    const errors: string[] = []

    for (const field of SELECTOR_CONTEXT_FIELDS) {
      const f = field as string
      if (allCanonicalParamIds.has(f)) continue

      if (idsInCanonicalPairs.has(f)) {
        errors.push(
          `"${f}" is a member subblock ID inside a canonical pair — use the canonicalParamId instead`
        )
        continue
      }

      if (!allSubBlockIds.has(f)) {
        errors.push(`"${f}" is not a canonicalParamId or subblock ID in any block definition`)
      }
    }

    if (errors.length > 0) {
      throw new Error(`SELECTOR_CONTEXT_FIELDS validation failed:\n${errors.join('\n')}`)
    }
  })
})
