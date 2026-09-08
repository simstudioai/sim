/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockState } from '@/stores/workflows/workflow/types'

vi.unmock('@/blocks/registry')

import {
  backfillCanonicalModes,
  migrateCanonicalModeIds,
  migrateSubblockIds,
  SUBBLOCK_ID_MIGRATIONS,
} from '@/lib/workflows/migrations/subblock-migrations'
import * as blocksBarrel from '@/blocks'
import { getBlock as getRealBlock } from '@/blocks/registry'

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
    for (const [blockType, migrations] of Object.entries(SUBBLOCK_ID_MIGRATIONS)) {
      const config = getAllBlocks().find((block) => block.type === blockType)
      if (!config) {
        offenders.push(`${blockType} (block not registered)`)
        continue
      }
      const liveIds = new Set((config.subBlocks ?? []).map((subBlock) => subBlock.id))
      for (const { from, to } of migrations) {
        if (to.startsWith('_removed_')) continue
        if (!liveIds.has(to)) offenders.push(`${blockType}.${from} -> ${to}`)
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * A scope naming an operation the block cannot select never fires, so the
   * legacy value it was added to rescue stays stranded — a silent no-op that
   * reads as a shipped fix.
   */
  it('every operation scope names an operation the block offers', () => {
    const offenders: string[] = []
    for (const [blockType, migrations] of Object.entries(SUBBLOCK_ID_MIGRATIONS)) {
      const config = getAllBlocks().find((block) => block.type === blockType)
      const operationConfig = config?.subBlocks?.find((subBlock) => subBlock.id === 'operation')
      const offered = new Set(
        (Array.isArray(operationConfig?.options) ? operationConfig.options : []).map((option) =>
          typeof option === 'string' ? option : ((option as { id?: string }).id ?? '')
        )
      )
      for (const { from, to, whenOperation } of migrations) {
        for (const operation of whenOperation ?? []) {
          if (!offered.has(operation))
            offenders.push(`${blockType}.${from} -> ${to} @ ${operation}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * An unconditional rename off an id that is still a live control steals that
   * control's value on every load. Every such rename must be operation-scoped.
   */
  it('never renames off an id that is still a live control, unscoped', () => {
    const offenders: string[] = []
    for (const [blockType, migrations] of Object.entries(SUBBLOCK_ID_MIGRATIONS)) {
      const config = getAllBlocks().find((block) => block.type === blockType)
      if (!config) continue
      const liveIds = new Set((config.subBlocks ?? []).map((subBlock) => subBlock.id))
      for (const { from, to, whenOperation } of migrations) {
        if (whenOperation) continue
        if (liveIds.has(from)) offenders.push(`${blockType}.${from} -> ${to}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('migrateSubblockIds', () => {
  it('discards group selectors while preserving connected-account operation settings', () => {
    const email = { id: 'email', type: 'short-input' as const, value: 'person@example.com' }
    const operation = { id: 'operation', type: 'dropdown' as const, value: 'list_credentials' }
    const input = {
      b1: makeBlock({
        type: 'credential_group',
        subBlocks: {
          credentialGroup: { id: 'credentialGroup', type: 'dropdown', value: 'group-1' },
          manualCredentialGroup: {
            id: 'manualCredentialGroup',
            type: 'short-input',
            value: '<other-group.id>',
          },
          email,
          operation,
        },
      }),
    }

    const { blocks, migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(true)
    expect(blocks.b1.subBlocks).toEqual({ email, operation })
    expect(migrateSubblockIds(blocks).migrated).toBe(false)
  })

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

  it.each(['slack', 'slack_v2'])(
    'removes the retired channel page cap from %s while preserving pagination inputs',
    (type) => {
      const input = {
        b1: makeBlock({
          type,
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'list_channels' },
            channelMaxPages: { id: 'channelMaxPages', type: 'short-input', value: '200' },
            channelLimit: { id: 'channelLimit', type: 'short-input', value: '50' },
            paginationCursor: { id: 'paginationCursor', type: 'short-input', value: 'cursor-2' },
            historyMaxPages: { id: 'historyMaxPages', type: 'short-input', value: '10' },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(true)
      expect(blocks.b1.subBlocks).not.toHaveProperty('channelMaxPages')
      expect(blocks.b1.subBlocks).not.toHaveProperty('_removed_channelMaxPages')
      expect(blocks.b1.subBlocks.channelLimit.value).toBe('50')
      expect(blocks.b1.subBlocks.paginationCursor.value).toBe('cursor-2')
      expect(blocks.b1.subBlocks.historyMaxPages.value).toBe('10')
      expect(migrateSubblockIds(blocks).migrated).toBe(false)
    }
  )

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
              SUBBLOCK_ID_MIGRATIONS.snowflake.map(({ from }) => [
                from,
                { id: from, type: 'short-input', value: `value-${from}` },
              ])
            ),
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(true)
      // The advanced text members, not the pickers: a migrated block has no
      // credential yet, so a picker could not hydrate the stored name.
      for (const { from, to } of SUBBLOCK_ID_MIGRATIONS.snowflake) {
        if (to.startsWith('_removed_')) continue
        expect(blocks.b1.subBlocks[to]?.value, `${from} -> ${to}`).toBe(`value-${from}`)
        expect(blocks.b1.subBlocks[from], from).toBeUndefined()
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

  describe('servicenow block', () => {
    it('moves a legacy Read Records projection onto readFields', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'servicenow',
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'servicenow_read_record' },
            fields: {
              id: 'fields',
              type: 'short-input',
              value: 'number,short_description,priority',
            },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(true)
      expect(blocks.b1.subBlocks.readFields.value).toBe('number,short_description,priority')
      expect(blocks.b1.subBlocks.fields).toBeUndefined()
    })

    /**
     * The shipped block shared `fields` between the Create/Update Record JSON
     * body and the Read Records projection, and a subblock value survives an
     * operation switch. So `operation: servicenow_read_record` holding a JSON
     * body under `fields` is a reachable saved state, and promoting that body
     * onto `readFields` would send it as `sysparm_fields`.
     */
    it('leaves a Create Record JSON body under fields when the operation was switched to Read Records', () => {
      const body = '{\n  "short_description": "Issue description",\n  "priority": "1"\n}'
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'servicenow',
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'servicenow_read_record' },
            fields: { id: 'fields', type: 'code', value: body },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(false)
      expect(blocks.b1.subBlocks.readFields).toBeUndefined()
      expect(blocks.b1.subBlocks.fields.value).toBe(body)
    })

    /**
     * A scalar body carries no `{` or `[`, so a prefix check would have read it
     * as a field list. Parsing is what separates the two spaces.
     */
    it.each([
      ['a boolean', 'true'],
      ['a quoted string', '"short_description"'],
      ['a number', '42'],
      ['null', 'null'],
    ])('leaves %s under fields rather than promoting it to a projection', (_label, body) => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'servicenow',
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'servicenow_read_record' },
            fields: { id: 'fields', type: 'code', value: body },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(false)
      expect(blocks.b1.subBlocks.readFields).toBeUndefined()
      expect(blocks.b1.subBlocks.fields.value).toBe(body)
    })

    /**
     * A saved body is not always well-formed JSON — it can be a half-typed
     * draft or carry an unquoted `<block.output>` reference. Migrating one
     * moves it to `readFields` AND drops the original key, so the draft is
     * gone. The field-list shape is what rejects these; parseability cannot.
     */
    it.each([
      ['a half-typed body', '{\n  "short_description": '],
      ['an unquoted block reference', '{ "short_description": <agent.content> }'],
      ['a trailing-comma body', '{ "priority": "1", }'],
      ['a quoted field name', '"short_description"'],
    ])('leaves %s under fields', (_label, body) => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'servicenow',
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'servicenow_read_record' },
            fields: { id: 'fields', type: 'code', value: body },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(false)
      expect(blocks.b1.subBlocks.readFields).toBeUndefined()
      expect(blocks.b1.subBlocks.fields.value).toBe(body)
    })

    it('still migrates a dotted-walk projection', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'servicenow',
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'servicenow_read_record' },
            fields: { id: 'fields', type: 'short-input', value: 'number, cmdb_ci.name, sys_id' },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(true)
      expect(blocks.b1.subBlocks.readFields.value).toBe('number, cmdb_ci.name, sys_id')
    })

    it('leaves a JSON array value under fields as well', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'servicenow',
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'servicenow_read_record' },
            fields: { id: 'fields', type: 'code', value: '["short_description"]' },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(false)
      expect(blocks.b1.subBlocks.readFields).toBeUndefined()
      expect(blocks.b1.subBlocks.fields.value).toBe('["short_description"]')
    })

    it('leaves the JSON body alone on create', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'servicenow',
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'servicenow_create_record' },
            fields: { id: 'fields', type: 'code', value: '{"short_description":"x"}' },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(false)
      expect(blocks.b1.subBlocks.readFields).toBeUndefined()
      expect(blocks.b1.subBlocks.fields.value).toBe('{"short_description":"x"}')
    })
  })

  /**
   * `okta_remove_user_from_app` reached the block in #6741 (`d45dad7e8b`),
   * whose only release tag is v0.8.3 — the same release that split `sendEmail`
   * into `sendDeactivationEmail`. In v0.8.2 the operation does not exist and
   * `sendEmail` covers only activate/deactivate/reset/delete, so no saved state
   * can hold a remove-from-app preference under `sendEmail`, and widening the
   * scope would only let an activation-era value be promoted.
   */
  describe('okta block', () => {
    it('renames the deactivation half of the shared send-email switch', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'okta',
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'okta_deactivate_user' },
            sendEmail: { id: 'sendEmail', type: 'switch', value: 'true' },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(true)
      expect(blocks.b1.subBlocks.sendDeactivationEmail.value).toBe('true')
      expect(blocks.b1.subBlocks.sendEmail).toBeUndefined()
    })

    it('leaves the activation half on sendEmail', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'okta',
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'okta_activate_user' },
            sendEmail: { id: 'sendEmail', type: 'switch', value: 'false' },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(false)
      expect(blocks.b1.subBlocks.sendEmail.value).toBe('false')
      expect(blocks.b1.subBlocks.sendDeactivationEmail).toBeUndefined()
    })
  })

  describe('quickbooks block', () => {
    function quickbooksBlock(subBlocks: Record<string, unknown>) {
      return {
        b1: makeBlock({
          type: 'quickbooks',
          subBlocks: subBlocks as BlockState['subBlocks'],
        }),
      }
    }

    it('moves a by-ID read target onto readTransactionId', () => {
      const { blocks, migrated } = migrateSubblockIds(
        quickbooksBlock({
          operation: {
            id: 'operation',
            type: 'dropdown',
            value: 'quickbooks_read_purchasing_transactions',
          },
          readMode: { id: 'readMode', type: 'dropdown', value: 'by_id' },
          transactionId: { id: 'transactionId', type: 'short-input', value: '5' },
        })
      )

      expect(migrated).toBe(true)
      expect(blocks.b1.subBlocks.readTransactionId.value).toBe('5')
      expect(blocks.b1.subBlocks.transactionId).toBeUndefined()
    })

    it('moves the sales and accounting by-ID read targets too', () => {
      for (const operation of [
        'quickbooks_read_sales_transactions',
        'quickbooks_read_accounting_transactions',
      ]) {
        const { blocks, migrated } = migrateSubblockIds(
          quickbooksBlock({
            operation: { id: 'operation', type: 'dropdown', value: operation },
            transactionId: { id: 'transactionId', type: 'short-input', value: '7' },
          })
        )

        expect(migrated).toBe(true)
        expect(blocks.b1.subBlocks.readTransactionId.value).toBe('7')
      }
    })

    it('leaves an update target on transactionId', () => {
      const { blocks, migrated } = migrateSubblockIds(
        quickbooksBlock({
          operation: {
            id: 'operation',
            type: 'dropdown',
            value: 'quickbooks_update_purchase_order',
          },
          transactionId: { id: 'transactionId', type: 'short-input', value: '5' },
        })
      )

      expect(migrated).toBe(false)
      expect(blocks.b1.subBlocks.transactionId.value).toBe('5')
      expect(blocks.b1.subBlocks.readTransactionId).toBeUndefined()
    })

    it('leaves a void target on transactionId', () => {
      const { blocks, migrated } = migrateSubblockIds(
        quickbooksBlock({
          operation: { id: 'operation', type: 'dropdown', value: 'quickbooks_void_invoice' },
          transactionId: { id: 'transactionId', type: 'short-input', value: '9' },
        })
      )

      expect(migrated).toBe(false)
      expect(blocks.b1.subBlocks.transactionId.value).toBe('9')
      expect(blocks.b1.subBlocks.readTransactionId).toBeUndefined()
    })

    it('recovers each retired summarize-columns subset onto reportSummarizeBy', () => {
      for (const [from, value] of [
        ['reportCustomerSalesSummarizeBy', 'item'],
        ['reportVendorExpenseSummarizeBy', 'vendor'],
        ['reportTimeSummarizeBy', 'quarter'],
      ] as const) {
        const { blocks, migrated } = migrateSubblockIds(
          quickbooksBlock({
            operation: {
              id: 'operation',
              type: 'dropdown',
              value: 'quickbooks_run_financial_report',
            },
            [from]: { id: from, type: 'dropdown', value },
          })
        )

        expect(migrated).toBe(true)
        expect(blocks.b1.subBlocks.reportSummarizeBy.value).toBe(value)
        expect(blocks.b1.subBlocks[from]).toBeUndefined()
      }
    })

    it('never clobbers a reportSummarizeBy value that is already set', () => {
      const { blocks, migrated } = migrateSubblockIds(
        quickbooksBlock({
          operation: {
            id: 'operation',
            type: 'dropdown',
            value: 'quickbooks_run_financial_report',
          },
          reportSummarizeBy: { id: 'reportSummarizeBy', type: 'dropdown', value: 'month' },
          reportCustomerSalesSummarizeBy: {
            id: 'reportCustomerSalesSummarizeBy',
            type: 'dropdown',
            value: 'item',
          },
        })
      )

      expect(migrated).toBe(true)
      expect(blocks.b1.subBlocks.reportSummarizeBy.value).toBe('month')
      expect(blocks.b1.subBlocks.reportCustomerSalesSummarizeBy).toBeUndefined()
    })

    it('moves the download-side file name onto downloadAttachmentFileName', () => {
      const { blocks, migrated } = migrateSubblockIds(
        quickbooksBlock({
          operation: {
            id: 'operation',
            type: 'dropdown',
            value: 'quickbooks_download_attachment',
          },
          attachmentFileName: {
            id: 'attachmentFileName',
            type: 'short-input',
            value: 'receipt.pdf',
          },
        })
      )

      expect(migrated).toBe(true)
      expect(blocks.b1.subBlocks.downloadAttachmentFileName.value).toBe('receipt.pdf')
      expect(blocks.b1.subBlocks.attachmentFileName).toBeUndefined()
    })

    it('leaves the add-side file name on attachmentFileName', () => {
      const { blocks, migrated } = migrateSubblockIds(
        quickbooksBlock({
          operation: { id: 'operation', type: 'dropdown', value: 'quickbooks_add_attachment' },
          attachmentKind: { id: 'attachmentKind', type: 'dropdown', value: 'file' },
          attachmentFileName: {
            id: 'attachmentFileName',
            type: 'short-input',
            value: 'receipt.pdf',
          },
        })
      )

      expect(migrated).toBe(false)
      expect(blocks.b1.subBlocks.attachmentFileName.value).toBe('receipt.pdf')
      expect(blocks.b1.subBlocks.downloadAttachmentFileName).toBeUndefined()
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

describe('migrateCanonicalModeIds', () => {
  function mistralBlock(data: Record<string, unknown>, subBlocks: Record<string, unknown>) {
    return makeBlock({ type: 'mistral_parse_v3', data, subBlocks } as never)
  }

  it('carries the selection across the document -> file rename', () => {
    const { blocks, migrated } = migrateCanonicalModeIds({
      b1: mistralBlock({ canonicalModes: { document: 'advanced' } }, {}),
    })

    expect(migrated).toBe(true)
    const modes = blocks.b1.data?.canonicalModes as Record<string, string>
    expect(modes).toEqual({ file: 'advanced' })
  })

  /**
   * The case the backfill alone cannot recover. `setBlockCanonicalMode` writes
   * the mode without clearing the sibling, so a workflow that uploaded a file,
   * switched to advanced, then typed a reference holds both values — and
   * `resolveCanonicalMode` prefers basic whenever the basic side is populated.
   * Without the rename the run would silently switch to the uploaded file.
   */
  it('preserves advanced when both sides hold a value, which the backfill would not', () => {
    const both = {
      fileUpload: { id: 'fileUpload', type: 'file-upload', value: { name: 'a.pdf' } },
      fileReference: { id: 'fileReference', type: 'short-input', value: '<block.file>' },
    }

    const { blocks } = migrateCanonicalModeIds({
      b1: mistralBlock({ canonicalModes: { document: 'advanced' } }, both),
    })
    expect((blocks.b1.data?.canonicalModes as Record<string, string>).file).toBe('advanced')

    // Same input through the backfill alone resolves to basic — the regression
    // this migration exists to prevent.
    const { blocks: backfilled } = backfillCanonicalModes({
      b1: mistralBlock({ canonicalModes: {} }, both),
    })
    expect((backfilled.b1.data?.canonicalModes as Record<string, string>).file).toBe('basic')
  })

  it('leaves a block that already stores the current id alone', () => {
    const { blocks, migrated } = migrateCanonicalModeIds({
      b1: mistralBlock({ canonicalModes: { file: 'basic' } }, {}),
    })

    expect(migrated).toBe(false)
    expect(blocks.b1.data?.canonicalModes).toEqual({ file: 'basic' })
  })

  it('prefers a value already written under the current id over the legacy one', () => {
    const { blocks } = migrateCanonicalModeIds({
      b1: mistralBlock({ canonicalModes: { document: 'advanced', file: 'basic' } }, {}),
    })

    expect(blocks.b1.data?.canonicalModes).toEqual({ file: 'basic' })
  })

  it('does not touch a block type with no canonical rename', () => {
    const { migrated } = migrateCanonicalModeIds({
      b1: makeBlock({ type: 'knowledge', data: { canonicalModes: { document: 'advanced' } } }),
    })

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
