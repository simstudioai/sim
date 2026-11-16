/**
 * The core-shard encoding against hand-built catalogs. The registry-wide proof (every block of the
 * live registry round-trips) is `apps/sim/lib/workflows/code/catalog/build.test.ts`; these cover
 * the shapes it cannot force: a catalog written in expanded form, dangling references, and an
 * input reused across builds.
 */
import { describe, expect, it } from 'vitest'
import { TEST_CATALOG } from '../compile/test-catalog'
import { stableStringify } from '../hash'
import { catalog as PRINT_CATALOG } from '../print/__fixtures__/catalog'
import { compactBlockCatalog } from './compact'
import type { BlockCatalog, CatalogSubBlock, ExpandedBlockCatalog } from './types'
import { catalogBlock, expandBlockCatalog } from './view'

function sub(id: string, extra: Partial<CatalogSubBlock> = {}): CatalogSubBlock {
  return { id, type: 'short-input', valueKind: 'string', storage: 'native', ...extra }
}

const OPERATIONS = ['send', 'read', 'update', 'delete']

/** Every encoding at once: a spread trigger, a field two blocks share, a repeated list. */
function sharingCatalog(): ExpandedBlockCatalog {
  const shared = sub('channel', {
    title: 'Channel',
    condition: { field: 'operation', value: OPERATIONS },
    options: [
      { id: 'general', label: 'General' },
      { id: 'random', label: 'random' },
    ],
  })
  const triggerFields = [
    sub('webhookUrl', { mode: 'trigger', readOnly: true }),
    sub('secret', { mode: 'trigger', password: true }),
  ]
  const outputs = {
    message: {
      type: 'json' as const,
      properties: { text: { type: 'string' as const, description: 'Body' } },
    },
  }
  const block = (type: string): ExpandedBlockCatalog['blocks'][string] => ({
    type,
    name: type,
    category: 'tools',
    subBlocks: [
      sub('operation', {
        type: 'dropdown',
        options: OPERATIONS.map((id) => ({ id, label: id.toUpperCase() })),
        surface: 'action',
      }),
      { ...shared, surface: 'action' },
      sub('limit', { required: { field: 'operation', value: OPERATIONS }, surface: 'action' }),
      ...triggerFields.map((field) => ({ ...field, surface: 'trigger' as const })),
    ],
    tools: { access: [], selector: 'single' },
    inputs: { channel: { type: 'string' } },
    outputs,
    graph: { canBeTarget: true, errorPort: true, container: null, annotationOnly: false },
    triggers: { enabled: true, available: ['chat_webhook'] },
  })
  return {
    catalogVersion: 1,
    hash: 'unused',
    sdkMajor: 1,
    blocks: { chat: block('chat'), chat_v2: block('chat_v2') },
    triggers: {
      chat_webhook: {
        id: 'chat_webhook',
        provider: 'chat',
        name: 'Chat Webhook',
        subBlocks: triggerFields,
        outputs,
      },
    },
    builders: { 'chat.send': { type: 'chat', operation: 'send' } },
  }
}

function roundTrip(expanded: ExpandedBlockCatalog): ExpandedBlockCatalog {
  const { hash, ...rest } = expanded
  const { core, docs } = compactBlockCatalog(rest)
  return expandBlockCatalog({ ...core, hash }, (type) => docs[type])
}

describe('compactBlockCatalog', () => {
  it('round-trips every fixture catalog through the core shard and its docs', () => {
    for (const catalog of [TEST_CATALOG, PRINT_CATALOG, sharingCatalog()]) {
      const expanded = expandBlockCatalog(catalog)
      expect(roundTrip(expanded)).toEqual(expanded)
    }
  })

  it('stores a spread trigger, a repeated field and a repeated list once each', () => {
    const { hash, ...rest } = sharingCatalog()
    const { core, docs } = compactBlockCatalog(rest)
    const entries = core.blocks.chat.subBlocks
    expect(entries.filter((entry) => 'trigger' in entry)).toEqual([
      { trigger: 'chat_webhook', start: 0, count: 2 },
    ])
    expect(core.subBlocks?.length).toBeGreaterThan(0)
    expect(core.lists).toEqual([OPERATIONS])
    expect(core.outputs?.length).toBe(1)
    expect(docs.chat.inputs).toEqual({ channel: { type: 'string' } })
    expect(docs.chat.optionLabels).toEqual({ '1': ['General', 'random'] })
  })

  it('leaves its input untouched, so a rebuild from the same objects gives the same bytes', () => {
    const { hash, ...rest } = sharingCatalog()
    const before = stableStringify(rest)
    const first = stableStringify(compactBlockCatalog(rest))
    expect(stableStringify(rest)).toBe(before)
    expect(stableStringify(compactBlockCatalog(rest))).toBe(first)
  })
})

describe('catalog view', () => {
  it('reads a catalog written in expanded form unchanged', () => {
    for (const [type, block] of Object.entries(TEST_CATALOG.blocks)) {
      expect(catalogBlock(TEST_CATALOG, type)).toEqual(block)
    }
  })

  it('throws on a reference the shard does not hold instead of dropping the field', () => {
    const { hash, ...rest } = sharingCatalog()
    const { core } = compactBlockCatalog(rest)
    const broken: BlockCatalog = { ...core, hash, subBlocks: [], lists: [] }
    expect(() => catalogBlock(broken, 'chat')).toThrow(/does not exist/)
  })

  it('answers no block for an inherited property name', () => {
    expect(catalogBlock(TEST_CATALOG, 'constructor')).toBeUndefined()
  })
})
