/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockState } from '@/stores/workflows/workflow/types'

vi.unmock('@/blocks/registry')

import * as blocksBarrel from '@/blocks'
import { getBlock as getRealBlock } from '@/blocks/registry'
import {
  backfillCanonicalModes,
  migrateSubblockIds,
  SUBBLOCK_ID_MIGRATIONS,
} from './subblock-migrations'

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

/**
 * `dropParkedSubblocks` deletes any subblock whose id starts with `_removed_`,
 * on the assumption that no live block declares one. Nothing enforces that
 * naming rule at the block level, so pin it here — a block that adopted the
 * prefix for a real field would have its value silently deleted on every load.
 */
describe('_removed_ prefix invariant', () => {
  it('is never used as a live subblock id', () => {
    const offenders = getAllBlocks().flatMap((block) =>
      (block.subBlocks ?? [])
        .filter((subBlock) => subBlock.id.startsWith('_removed_'))
        .map((subBlock) => `${block.type}.${subBlock.id}`)
    )
    expect(offenders).toEqual([])
  })
})

/**
 * A migration target that names no live subblock silently drops the value: the
 * rename writes a key nothing reads, and the sweep or the serializer discards
 * it. Nothing else checks the right-hand side of the map.
 */
describe('migration targets', () => {
  it('every rename points at a subblock that still exists', () => {
    const offenders: string[] = []
    for (const [blockType, renames] of Object.entries(SUBBLOCK_ID_MIGRATIONS)) {
      const config = getAllBlocks().find((block) => block.type === blockType)
      if (!config) {
        offenders.push(`${blockType} (block not registered)`)
        continue
      }
      const liveIds = new Set((config.subBlocks ?? []).map((subBlock) => subBlock.id))
      for (const [legacyId, currentId] of Object.entries(renames)) {
        if (currentId.startsWith('_removed_')) continue
        if (!liveIds.has(currentId)) offenders.push(`${blockType}.${legacyId} -> ${currentId}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

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
    it('renames the object fields onto their advanced text inputs', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'snowflake',
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'insert_rows' },
            // Every legacy id in the map, so a rename added later without a
            // matching assertion still fails here.
            ...Object.fromEntries(
              Object.keys(SUBBLOCK_ID_MIGRATIONS.snowflake).map((legacyId) => [
                legacyId,
                { id: legacyId, type: 'short-input', value: `value-${legacyId}` },
              ])
            ),
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(true)
      // The advanced text members, not the pickers: a migrated block has no
      // credential yet, so a picker could not hydrate the stored name.
      for (const [legacyId, currentId] of Object.entries(SUBBLOCK_ID_MIGRATIONS.snowflake)) {
        if (currentId.startsWith('_removed_')) continue
        expect(blocks.b1.subBlocks[currentId]?.value, `${legacyId} -> ${currentId}`).toBe(
          `value-${legacyId}`
        )
        expect(blocks.b1.subBlocks[legacyId], legacyId).toBeUndefined()
      }
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

  /**
   * An earlier version of this migration renamed retired fields into a
   * `_removed_*` key instead of deleting them, so deployed workflows still hold
   * those values. They match no `oldId`, so only a dedicated sweep clears them.
   */
  it('drops values parked by an earlier run of the migration', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'rippling',
        subBlocks: {
          _removed_email: { id: '_removed_email', type: 'short-input', value: 'ada@example.com' },
          _removed_firstName: { id: '_removed_firstName', type: 'short-input', value: 'Ada' },
          // Not in rippling's rename map, so it must survive the sweep untouched.
          credential: { id: 'credential', type: 'oauth-input', value: 'cred-1' },
        },
      }),
      // A block type with no rename map at all must still be swept.
      b2: makeBlock({
        type: 'snowflake',
        subBlocks: {
          _removed_apiKey: {
            id: '_removed_apiKey',
            type: 'short-input',
            value: 'super-secret-pat',
          },
        },
      }),
    }

    const { blocks, migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(true)
    expect(blocks.b1.subBlocks._removed_email).toBeUndefined()
    expect(blocks.b1.subBlocks._removed_firstName).toBeUndefined()
    expect(blocks.b1.subBlocks.credential?.value).toBe('cred-1')
    expect(blocks.b2.subBlocks._removed_apiKey).toBeUndefined()
    expect(JSON.stringify(blocks)).not.toContain('super-secret-pat')
    expect(JSON.stringify(blocks)).not.toContain('ada@example.com')
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

  /**
   * The suffixed Cloudflare read-filter ids existed only between #6740 and the
   * restore, and never shipped in a release. They are dropped rather than renamed
   * onto `name`/`type`/`content`/`proxied`/`tags`, which every Cloudflare block
   * already materializes — a rename would hit the collision guard and discard the
   * value regardless, while leaving the stale key parked in state.
   */
  describe('cloudflare block', () => {
    it('drops the staging-only read-filter ids without disturbing the restored ids', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'cloudflare',
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'list_dns_records' },
            zoneNameFilter: { id: 'zoneNameFilter', type: 'short-input', value: 'example.com' },
            dnsNameFilter: { id: 'dnsNameFilter', type: 'short-input', value: 'www' },
            dnsTypeFilter: { id: 'dnsTypeFilter', type: 'dropdown', value: 'A' },
            dnsContentFilter: { id: 'dnsContentFilter', type: 'short-input', value: '1.2.3.4' },
            dnsProxiedFilter: { id: 'dnsProxiedFilter', type: 'dropdown', value: 'true' },
            purgeTags: { id: 'purgeTags', type: 'short-input', value: 'tag-a' },
            cursor: { id: 'cursor', type: 'short-input', value: 'abc' },
            name: { id: 'name', type: 'short-input', value: '' },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(true)
      for (const legacyId of [
        'zoneNameFilter',
        'dnsNameFilter',
        'dnsTypeFilter',
        'dnsContentFilter',
        'dnsProxiedFilter',
        'purgeTags',
        'cursor',
      ]) {
        expect(blocks.b1.subBlocks[legacyId]).toBeUndefined()
        expect(blocks.b1.subBlocks[`_removed_${legacyId}`]).toBeUndefined()
      }
      expect(blocks.b1.subBlocks.operation.value).toBe('list_dns_records')
      expect(blocks.b1.subBlocks.name.value).toBe('')
    })

    it('leaves a workflow saved on the restored ids untouched', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'cloudflare',
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'list_dns_records' },
            name: { id: 'name', type: 'short-input', value: 'www' },
            type: { id: 'type', type: 'dropdown', value: 'A' },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(false)
      expect(blocks.b1.subBlocks.name.value).toBe('www')
      expect(blocks.b1.subBlocks.type.value).toBe('A')
    })
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
