/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'

vi.unmock('@/blocks/registry')

import * as blocksBarrel from '@/blocks'
import { getBlock as getRealBlock } from '@/blocks/registry'
import { backfillCanonicalModes, migrateSubblockIds } from './subblock-migrations'

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
  it('should preserve Instagram insight metrics after the subblock rename', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'instagram',
        subBlocks: {
          metrics: {
            id: 'metrics',
            type: 'short-input',
            value: 'reach,views',
          },
        },
      }),
    }

    const { blocks, migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(true)
    expect(blocks.b1.subBlocks.insightMetrics).toEqual({
      id: 'insightMetrics',
      type: 'short-input',
      value: 'reach,views',
    })
    expect(blocks.b1.subBlocks.metrics).toBeUndefined()
  })

  describe('snowflake block', () => {
    it('renames the object fields onto their pickers', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'snowflake',
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'insert_rows' },
            database: { id: 'database', type: 'short-input', value: 'ANALYTICS' },
            schema: { id: 'schema', type: 'short-input', value: 'PUBLIC' },
            table: { id: 'table', type: 'short-input', value: 'EVENTS' },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(true)
      expect(blocks.b1.subBlocks.databaseSelector?.value).toBe('ANALYTICS')
      expect(blocks.b1.subBlocks.schemaSelector?.value).toBe('PUBLIC')
      expect(blocks.b1.subBlocks.tableSelector?.value).toBe('EVENTS')
      expect(blocks.b1.subBlocks.database).toBeUndefined()
    })

    /**
     * Secret scrubbing for exports walks the block config, so a value parked
     * under a key the config no longer declares would never be cleared. A
     * `_removed_` target must drop the value, not carry it forward.
     */
    it('discards the retired host and programmatic access token', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'snowflake',
          subBlocks: {
            host: { id: 'host', type: 'short-input', value: 'acme.snowflakecomputing.com' },
            apiKey: { id: 'apiKey', type: 'short-input', value: 'super-secret-pat' },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(true)
      expect(blocks.b1.subBlocks.apiKey).toBeUndefined()
      expect(blocks.b1.subBlocks.host).toBeUndefined()
      expect(blocks.b1.subBlocks._removed_apiKey).toBeUndefined()
      expect(blocks.b1.subBlocks._removed_host).toBeUndefined()
      expect(JSON.stringify(blocks.b1)).not.toContain('super-secret-pat')
    })
  })

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
      expect(blocks.b1.subBlocks.knowledgeBaseSelector).toEqual({
        id: 'knowledgeBaseSelector',
        type: 'knowledge-base-selector',
        value: 'kb-uuid-123',
      })
      expect(blocks.b1.subBlocks.knowledgeBaseId).toBeUndefined()
      expect(blocks.b1.subBlocks.operation.value).toBe('search')
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
      expect(blocks.b1.subBlocks.knowledgeBaseSelector.value).toBe('fresh-kb')
      expect(blocks.b1.subBlocks.knowledgeBaseId).toBeUndefined()
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
      expect(blocks.b1.subBlocks.knowledgeBaseSelector.value).toBe('kb-uuid')
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

    expect(input.b1.subBlocks.knowledgeBaseId).toBeDefined()
    expect(blocks.b1.subBlocks.knowledgeBaseSelector).toBeDefined()
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
    expect(blocks.b1.subBlocks.code.value).toBe('console.log("hi")')
  })

  it('should repair malformed subBlocks for every block type without deleting values', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'function',
        subBlocks: {
          code: { id: 'code', type: 'unknown', value: 'console.log("hi")' },
          language: { value: 'javascript' },
          undefined: { type: 'unknown', value: null },
          noId: { type: 'short-input', value: 'stale' },
          noType: { id: 'noType', value: 'stale' },
          unknownType: { id: 'unknownType', type: 'unknown', value: 'preserved' },
          notRecord: 'stale',
          arrayValue: ['a', 'b'],
        } as unknown as BlockState['subBlocks'],
      }),
    }

    const { blocks, migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(true)
    expect(blocks.b1.subBlocks.code).toEqual({
      id: 'code',
      type: 'code',
      value: 'console.log("hi")',
    })
    expect(blocks.b1.subBlocks.language).toEqual({
      id: 'language',
      type: 'dropdown',
      value: 'javascript',
    })
    expect(blocks.b1.subBlocks.undefined).toBeUndefined()
    expect(blocks.b1.subBlocks.noId).toBeUndefined()
    expect(blocks.b1.subBlocks.noType).toBeUndefined()
    expect(blocks.b1.subBlocks.unknownType).toBeUndefined()
    expect(blocks.b1.subBlocks.notRecord).toBeUndefined()
    expect(blocks.b1.subBlocks.arrayValue).toBeUndefined()
  })

  it('should preserve malformed legacy subBlocks before renaming them', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        subBlocks: {
          knowledgeBaseId: {
            id: 'knowledgeBaseId',
            type: 'unknown',
            value: 'kb-uuid-123',
          },
        },
      }),
    }

    const { blocks, migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(true)
    expect(blocks.b1.subBlocks.knowledgeBaseId).toBeUndefined()
    expect(blocks.b1.subBlocks.knowledgeBaseSelector).toEqual({
      id: 'knowledgeBaseSelector',
      type: 'knowledge-base-selector',
      value: 'kb-uuid-123',
    })
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
    expect(blocks.b1.subBlocks.knowledgeBaseSelector.value).toBe('kb-1')
    expect(blocks.b2.subBlocks.knowledgeBaseSelector.value).toBe('kb-2')
    expect(blocks.b3.subBlocks.code).toBeDefined()
  })

  it('should handle blocks with empty subBlocks', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({ type: 'knowledge', subBlocks: {} }),
    }

    const { migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(false)
  })
})

describe('backfillCanonicalModes', () => {
  it('should add missing canonicalModes entry for knowledge block with basic value', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        data: {},
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'search' },
          knowledgeBaseSelector: {
            id: 'knowledgeBaseSelector',
            type: 'knowledge-base-selector',
            value: 'kb-uuid',
          },
        },
      }),
    }

    const { blocks, migrated } = backfillCanonicalModes(input)

    expect(migrated).toBe(true)
    const modes = blocks.b1.data?.canonicalModes as Record<string, string>
    expect(modes.knowledgeBaseId).toBe('basic')
  })

  it('should resolve to advanced when only the advanced value is set', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        data: {},
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'search' },
          manualKnowledgeBaseId: {
            id: 'manualKnowledgeBaseId',
            type: 'short-input',
            value: 'kb-uuid-manual',
          },
        },
      }),
    }

    const { blocks, migrated } = backfillCanonicalModes(input)

    expect(migrated).toBe(true)
    const modes = blocks.b1.data?.canonicalModes as Record<string, string>
    expect(modes.knowledgeBaseId).toBe('advanced')
  })

  it('should not overwrite existing canonicalModes entries', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        data: { canonicalModes: { knowledgeBaseId: 'advanced', documentId: 'basic' } },
        subBlocks: {
          knowledgeBaseSelector: {
            id: 'knowledgeBaseSelector',
            type: 'knowledge-base-selector',
            value: 'kb-uuid',
          },
        },
      }),
    }

    const { blocks, migrated } = backfillCanonicalModes(input)

    expect(migrated).toBe(false)
    const modes = blocks.b1.data?.canonicalModes as Record<string, string>
    expect(modes.knowledgeBaseId).toBe('advanced')
  })

  it('should skip blocks with no canonical pairs in their config', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'function',
        data: {},
        subBlocks: {
          code: { id: 'code', type: 'code', value: '' },
        },
      }),
    }

    const { migrated } = backfillCanonicalModes(input)

    expect(migrated).toBe(false)
  })

  it('should not mutate the input blocks', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        data: {},
        subBlocks: {
          knowledgeBaseSelector: {
            id: 'knowledgeBaseSelector',
            type: 'knowledge-base-selector',
            value: 'kb-uuid',
          },
        },
      }),
    }

    const { blocks } = backfillCanonicalModes(input)

    expect(input.b1.data?.canonicalModes).toBeUndefined()
    expect((blocks.b1.data?.canonicalModes as Record<string, string>).knowledgeBaseId).toBe('basic')
    expect(blocks).not.toBe(input)
  })

  it('should resolve correctly when existing field became the basic variant', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        data: {},
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'search' },
          knowledgeBaseSelector: {
            id: 'knowledgeBaseSelector',
            type: 'knowledge-base-selector',
            value: 'kb-uuid',
          },
          manualKnowledgeBaseId: {
            id: 'manualKnowledgeBaseId',
            type: 'short-input',
            value: '',
          },
        },
      }),
    }

    const { blocks, migrated } = backfillCanonicalModes(input)

    expect(migrated).toBe(true)
    const modes = blocks.b1.data?.canonicalModes as Record<string, string>
    expect(modes.knowledgeBaseId).toBe('basic')
  })

  it('should resolve correctly when existing field became the advanced variant', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        data: {},
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'search' },
          knowledgeBaseSelector: {
            id: 'knowledgeBaseSelector',
            type: 'knowledge-base-selector',
            value: '',
          },
          manualKnowledgeBaseId: {
            id: 'manualKnowledgeBaseId',
            type: 'short-input',
            value: 'manually-entered-kb-id',
          },
        },
      }),
    }

    const { blocks, migrated } = backfillCanonicalModes(input)

    expect(migrated).toBe(true)
    const modes = blocks.b1.data?.canonicalModes as Record<string, string>
    expect(modes.knowledgeBaseId).toBe('advanced')
  })

  it('should default to basic when neither value is set', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        data: {},
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'search' },
        },
      }),
    }

    const { blocks, migrated } = backfillCanonicalModes(input)

    expect(migrated).toBe(true)
    const modes = blocks.b1.data?.canonicalModes as Record<string, string>
    expect(modes.knowledgeBaseId).toBe('basic')
  })
})
