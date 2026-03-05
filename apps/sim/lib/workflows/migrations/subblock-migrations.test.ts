/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { migrateSubblockIds } from './subblock-migrations'

function makeBlock(overrides: Partial<BlockState> & { type: string }): BlockState {
  return {
    id: 'block-1',
    name: 'Test',
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    enabled: true,
    ...overrides,
  } as BlockState
}

describe('migrateSubblockIds', () => {
  describe('knowledge block', () => {
    it('should rename knowledgeBaseId to knowledgeBaseSelector', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'knowledge',
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'search' },
            knowledgeBaseId: {
              id: 'knowledgeBaseId',
              type: 'knowledge-base-selector',
              value: 'kb-uuid-123',
            },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(true)
      expect(blocks['b1'].subBlocks['knowledgeBaseSelector']).toEqual({
        id: 'knowledgeBaseSelector',
        type: 'knowledge-base-selector',
        value: 'kb-uuid-123',
      })
      expect(blocks['b1'].subBlocks['knowledgeBaseId']).toBeUndefined()
      expect(blocks['b1'].subBlocks['operation'].value).toBe('search')
    })

    it('should prefer new key when both old and new exist', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'knowledge',
          subBlocks: {
            knowledgeBaseId: {
              id: 'knowledgeBaseId',
              type: 'knowledge-base-selector',
              value: 'stale-kb',
            },
            knowledgeBaseSelector: {
              id: 'knowledgeBaseSelector',
              type: 'knowledge-base-selector',
              value: 'fresh-kb',
            },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(true)
      expect(blocks['b1'].subBlocks['knowledgeBaseSelector'].value).toBe('fresh-kb')
      expect(blocks['b1'].subBlocks['knowledgeBaseId']).toBeUndefined()
    })

    it('should not touch blocks that already use the new key', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'knowledge',
          subBlocks: {
            knowledgeBaseSelector: {
              id: 'knowledgeBaseSelector',
              type: 'knowledge-base-selector',
              value: 'kb-uuid',
            },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(false)
      expect(blocks['b1'].subBlocks['knowledgeBaseSelector'].value).toBe('kb-uuid')
    })
  })

  it('should not mutate the input blocks', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        subBlocks: {
          knowledgeBaseId: {
            id: 'knowledgeBaseId',
            type: 'knowledge-base-selector',
            value: 'kb-uuid',
          },
        },
      }),
    }

    const { blocks } = migrateSubblockIds(input)

    expect(input['b1'].subBlocks['knowledgeBaseId']).toBeDefined()
    expect(blocks['b1'].subBlocks['knowledgeBaseSelector']).toBeDefined()
    expect(blocks).not.toBe(input)
  })

  it('should skip blocks with no registered migrations', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'function',
        subBlocks: {
          code: { id: 'code', type: 'code', value: 'console.log("hi")' },
        },
      }),
    }

    const { blocks, migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(false)
    expect(blocks['b1'].subBlocks['code'].value).toBe('console.log("hi")')
  })

  it('should migrate multiple blocks in one pass', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        id: 'b1',
        type: 'knowledge',
        subBlocks: {
          knowledgeBaseId: {
            id: 'knowledgeBaseId',
            type: 'knowledge-base-selector',
            value: 'kb-1',
          },
        },
      }),
      b2: makeBlock({
        id: 'b2',
        type: 'knowledge',
        subBlocks: {
          knowledgeBaseId: {
            id: 'knowledgeBaseId',
            type: 'knowledge-base-selector',
            value: 'kb-2',
          },
        },
      }),
      b3: makeBlock({
        id: 'b3',
        type: 'function',
        subBlocks: {
          code: { id: 'code', type: 'code', value: '' },
        },
      }),
    }

    const { blocks, migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(true)
    expect(blocks['b1'].subBlocks['knowledgeBaseSelector'].value).toBe('kb-1')
    expect(blocks['b2'].subBlocks['knowledgeBaseSelector'].value).toBe('kb-2')
    expect(blocks['b3'].subBlocks['code']).toBeDefined()
  })

  it('should handle blocks with empty subBlocks', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({ type: 'knowledge', subBlocks: {} }),
    }

    const { migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(false)
  })
})
