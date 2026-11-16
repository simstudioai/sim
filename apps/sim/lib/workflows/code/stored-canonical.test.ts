/**
 * Reusing one canonicalize per source get or apply is only safe when the reused result equals
 * what a fresh canonicalize would give. Failure modes covered:
 * - a lock that renames a branch row is treated as changing nothing (stale diff base, wrong print);
 * - a lock that keys only some rows, or keys rows the stored graph lacks, is wrongly refused or
 *   wrongly accepted;
 * - a remembered resource-reference hint goes stale when a workflow starts referencing a new
 *   resource, and the stored graph is canonicalized against a resolver that cannot answer for it;
 * - a warm workflow still pays a second canonicalize pass.
 */
import {
  type BlockCatalog,
  type CatalogBlock,
  canonicalize,
  expandBlockCatalog,
  type ResourceKeyResolver,
  type ResourceKind,
  type WorkflowLockV1,
} from '@sim/workflow-code'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { isEqual } from 'es-toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  loadResourceKeyResolver: vi.fn(),
}))

vi.mock('@/lib/workflows/code/resources', () => ({
  loadResourceKeyResolver: hoisted.loadResourceKeyResolver,
}))
vi.unmock('@/blocks/registry')

import { buildBlockCatalog } from '@/lib/workflows/code/catalog/build'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import {
  canonicalizeStored,
  canonicalizeUnderLock,
  lockKeepsCanonical,
} from '@/lib/workflows/code/stored-canonical'
import { getBlockRegistry } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'

const { catalog } = buildBlockCatalog({
  blocks: Object.values(getBlockRegistry()),
  trigger: registryTrigger,
  sdkNames: SDK_NAMES,
})
const meta = { name: 'Reuse', description: null }

function block(
  id: string,
  type: string,
  name: string,
  values: Record<string, unknown>
): BlockState {
  return {
    id,
    type,
    name,
    position: { x: 0, y: 0 },
    enabled: true,
    outputs: {},
    subBlocks: Object.fromEntries(
      Object.entries(values).map(([subId, value]) => [
        subId,
        { id: subId, type: 'short-input', value },
      ])
    ),
  } as BlockState
}

function state(blocks: BlockState[]): WorkflowState {
  return {
    blocks: Object.fromEntries(blocks.map((entry) => [entry.id, entry])),
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
  }
}

const conditionRows = [
  { id: 'cond-a', title: 'if', value: '<start.x> > 1' },
  { id: 'cond-b', title: 'else if', value: '<start.x> > 0' },
  { id: 'cond-c', title: 'else', value: '' },
]
const branching = state([
  block('cond', 'condition', 'Gate', { conditions: JSON.stringify(conditionRows) }),
  block('route', 'router_v2', 'Route', {
    routes: JSON.stringify([
      { id: 'route-a', title: 'Sales', value: 'sales' },
      { id: 'route-b', title: 'Support', value: 'support', key: 'help' },
    ]),
  }),
])

function lockOf(blocks: WorkflowLockV1['blocks']): WorkflowLockV1 {
  return { version: 1, blocks, variables: {} }
}

describe('lockKeepsCanonical', () => {
  const lockless = canonicalize(branching, { catalog, meta })
  const keys = lockless.identity.blocks
  const gate = Object.values(keys).find((entry) => entry.id === 'cond')
  const route = Object.values(keys).find((entry) => entry.id === 'route')
  if (!gate?.branches || !route?.branches) throw new Error('fixture lost its branches')
  const gateBranches = gate.branches
  const routeBranches = route.branches
  const gateKeyOf = (rowId: string) =>
    Object.entries(gateBranches).find(([, id]) => id === rowId)?.[0] ?? ''

  const cases: Array<[string, WorkflowLockV1 | null]> = [
    ['no lock', null],
    ['a lock without branches', lockOf({ gate: { id: 'cond', ident: 'gate', order: 0 } })],
    [
      'every row keyed as the lockless pass keys it',
      lockOf({
        gate: { id: 'cond', ident: 'gate', order: 0, branches: gateBranches },
        route: { id: 'route', ident: 'route', order: 1, branches: routeBranches },
      }),
    ],
    [
      'one row keyed as the lockless pass keys it',
      lockOf({
        gate: {
          id: 'cond',
          ident: 'gate',
          order: 0,
          branches: { [gateKeyOf('cond-c')]: 'cond-c' },
        },
      }),
    ],
    [
      'keys for rows and blocks the graph does not have',
      lockOf({
        gate: { id: 'cond', ident: 'gate', order: 0, branches: { stale: 'cond-gone' } },
        ghost: { id: 'ghost', ident: 'ghost', order: 1, branches: { if: 'ghost-if' } },
      }),
    ],
    [
      'a row renamed by the lock',
      lockOf({
        gate: { id: 'cond', ident: 'gate', order: 0, branches: { highValue: 'cond-a' } },
      }),
    ],
    [
      'two rows swapped by the lock',
      lockOf({
        gate: {
          id: 'cond',
          ident: 'gate',
          order: 0,
          branches: { [gateKeyOf('cond-a')]: 'cond-b', [gateKeyOf('cond-b')]: 'cond-a' },
        },
      }),
    ],
    [
      'a router row given another key',
      lockOf({
        route: { id: 'route', ident: 'route', order: 1, branches: { sales: 'route-b' } },
      }),
    ],
  ]

  it.each(cases)('agrees with a fresh canonicalize for %s', (_name, lock) => {
    const locked = canonicalize(branching, { catalog, meta, lock })
    expect(lockKeepsCanonical(lock, lockless.identity)).toBe(isEqual(locked, lockless))
  })

  it('covers locks that change the result and locks that do not', () => {
    const outcomes = cases.map(([, lock]) =>
      isEqual(canonicalize(branching, { catalog, meta, lock }), lockless)
    )
    expect(outcomes).toContain(true)
    expect(outcomes).toContain(false)
  })

  it('returns the lockless result only when the lock changes nothing', () => {
    const options = { catalog, meta, resources: { toKey: () => null, toId: () => null } }
    const agreeing = lockOf({
      gate: { id: 'cond', ident: 'gate', order: 0, branches: gateBranches },
    })
    const renaming = lockOf({
      gate: { id: 'cond', ident: 'gate', order: 0, branches: { highValue: 'cond-a' } },
    })
    expect(canonicalizeUnderLock(branching, options, lockless, agreeing)).toBe(lockless)
    const renamed = canonicalizeUnderLock(branching, options, lockless, renaming)
    expect(renamed).not.toBe(lockless)
    expect(renamed).toEqual(canonicalize(branching, { ...options, lock: renaming }))
  })
})

/** A block type with a single-select resource field of `kind` that serializes in basic mode. */
function resourceField(kind: ResourceKind): { type: string; subBlockId: string } {
  const expanded = expandBlockCatalog(catalog)
  for (const [type, entry] of Object.entries(expanded.blocks) as Array<[string, CatalogBlock]>) {
    const field = entry.subBlocks.find(
      (subBlock) =>
        subBlock.valueKind === 'resource' &&
        subBlock.resourceKind === kind &&
        !subBlock.multiple &&
        subBlock.condition === undefined
    )
    if (field) return { type, subBlockId: field.id }
  }
  throw new Error(`no block with a ${kind} field`)
}

/** Resolves `<kind>-id` to `<kind>-key` for every loaded kind, like the real loader. */
interface References {
  ids?: { kind: ResourceKind; id: string }[]
  keys?: { kind: ResourceKind; key: string }[]
}

/** Answers only the references it was loaded with, as `loadResourceKeyResolver` does. */
function fakeResolver(references: References): ResourceKeyResolver {
  const ids = new Set((references.ids ?? []).map((ref) => `${ref.kind}:${ref.id}`))
  const keys = new Set((references.keys ?? []).map((ref) => `${ref.kind}:${ref.key}`))
  return {
    toKey: (kind, id) => (ids.has(`${kind}:${id}`) && id === `${kind}-id` ? `${kind}-key` : null),
    toId: (kind, key) =>
      keys.has(`${kind}:${key}`) && key === `${kind}-key` ? `${kind}-id` : null,
  }
}

const idsOf = (kinds: ResourceKind[]) => ({
  ids: kinds.map((kind) => ({ kind, id: `${kind}-id` })),
})

describe('canonicalizeStored', () => {
  const table = resourceField('table')
  const knowledge = resourceField('knowledge-base')
  const withTable = state([block('t', table.type, 'Rows', { [table.subBlockId]: 'table-id' })])
  const withTableAndKb = state([
    block('t', table.type, 'Rows', { [table.subBlockId]: 'table-id' }),
    block('k', knowledge.type, 'Docs', { [knowledge.subBlockId]: 'knowledge-base-id' }),
  ])
  const expected = (graph: WorkflowState, kinds: ResourceKind[]) =>
    canonicalize(graph, { catalog, meta, resources: fakeResolver(idsOf(kinds)) })

  beforeEach(() => {
    hoisted.loadResourceKeyResolver.mockImplementation(
      async (_workspaceId: string, references: References) => fakeResolver(references)
    )
  })

  it('resolves resource keys on a cold workflow, then needs one pass once warm', async () => {
    const input = {
      workflowId: 'wf-warm',
      workspaceId: 'ws',
      meta,
      catalog: catalog as BlockCatalog,
      createdBy: null,
    }
    const cold = await canonicalizeStored({ ...input, state: withTable })
    expect(cold.canonical).toEqual(expected(withTable, ['table']))
    expect(JSON.stringify(cold.canonical.workflow)).toContain('table-key')

    hoisted.loadResourceKeyResolver.mockClear()
    const warm = await canonicalizeStored({ ...input, state: withTable })
    expect(warm.canonical).toEqual(cold.canonical)
    expect(hoisted.loadResourceKeyResolver).toHaveBeenCalledTimes(1)
    expect(hoisted.loadResourceKeyResolver.mock.calls[0][1]).toEqual({
      ids: [{ kind: 'table', id: 'table-id' }],
      keys: [],
    })
  })

  it('re-resolves when a workflow starts referencing a resource its hint lacks', async () => {
    const input = {
      workflowId: 'wf-grows',
      workspaceId: 'ws',
      meta,
      catalog: catalog as BlockCatalog,
      createdBy: null,
    }
    await canonicalizeStored({ ...input, state: withTable })
    const grown = await canonicalizeStored({ ...input, state: withTableAndKb })
    expect(grown.canonical).toEqual(expected(withTableAndKb, ['table', 'knowledge-base']))
    expect(JSON.stringify(grown.canonical.workflow)).toContain('knowledge-base-key')
    expect(grown.loaded.ids.map((ref) => ref.kind).sort()).toEqual(['knowledge-base', 'table'])
  })

  it('keeps the remembered references per workflow', async () => {
    await canonicalizeStored({
      workflowId: 'wf-one',
      workspaceId: 'ws',
      meta,
      catalog,
      createdBy: null,
      state: withTableAndKb,
    })
    hoisted.loadResourceKeyResolver.mockClear()
    await canonicalizeStored({
      workflowId: 'wf-two',
      workspaceId: 'ws',
      meta,
      catalog,
      createdBy: null,
      state: withTable,
    })
    expect(hoisted.loadResourceKeyResolver.mock.calls[0][1]).toEqual({ ids: [], keys: [] })
  })
})
