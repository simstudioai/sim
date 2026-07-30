/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import * as blocksBarrel from '@/blocks'
import { getAllBlocks, getBlock as getRealBlock } from '@/blocks/registry'
import { buildSelectorContextFromBlock, SELECTOR_CONTEXT_FIELDS } from './context'
import { buildCanonicalIndex, isCanonicalPair } from './visibility'

/**
 * Under `isolate: false` the module under test may already be cached from an
 * earlier test file, bound to the global `@/blocks/registry` mock through the
 * `@/blocks` barrel. `vi.unmock` alone cannot rebind that cached instance, so
 * route the barrel's `getBlock` to the real registry via a spy on the shared
 * barrel namespace — it patches whichever instance the cached module reads.
 */
const getBlockSpy = vi.spyOn(blocksBarrel, 'getBlock').mockImplementation(getRealBlock)

afterAll(() => {
  getBlockSpy.mockRestore()
})

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

  it('resolves the ACTIVE member when both basic and advanced hold values (no last-write-wins)', () => {
    const subBlocks = {
      operation: { id: 'operation', type: 'dropdown', value: 'search' },
      knowledgeBaseSelector: {
        id: 'knowledgeBaseSelector',
        type: 'knowledge-base-selector',
        value: 'kb-basic',
      },
      manualKnowledgeBaseId: {
        id: 'manualKnowledgeBaseId',
        type: 'short-input',
        value: 'kb-advanced',
      },
    }
    // No override: the value heuristic keeps basic (matches a default-basic migrated block).
    expect(buildSelectorContextFromBlock('knowledge', subBlocks).knowledgeBaseId).toBe('kb-basic')
    // Explicit advanced toggle: the active member wins (the dormant basic value never leaks).
    expect(
      buildSelectorContextFromBlock('knowledge', subBlocks, {
        canonicalModes: { knowledgeBaseId: 'advanced' },
      }).knowledgeBaseId
    ).toBe('kb-advanced')
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

  it('should pass through workspaceId from opts', () => {
    const ctx = buildSelectorContextFromBlock(
      'knowledge',
      { operation: { id: 'operation', type: 'dropdown', value: 'search' } },
      { workspaceId: 'ws-123' }
    )

    expect(ctx.workspaceId).toBe('ws-123')
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
