/**
 * The generated round-trip corpus over the real block registry. Each case
 * is one stored `WorkflowState` with an upstream `start` trigger. Coverage is pairwise, not
 * cartesian:
 *
 * - every block type × every option of its `operation` dropdown, each in all-basic and (when that
 *   operation shows a canonical pair) all-advanced, the latter with the advanced toggle on;
 * - trigger mode for every trigger the block hosts;
 * - a standalone advanced field holding a value with the advanced toggle off;
 * - an error edge out of every block that can have one;
 * - tool-input lists with two tools of one type (every tool-input field);
 * - structural cases: condition/router title variants, `null` rows, 3+ and 6+ branches and
 *   reordered rows, legacy normalized-name collisions, every loop and parallel type including
 *   nesting and one workflow holding all six, a condition inside a parallel inside a loop,
 *   disabled containers, an empty workflow and a notes-only one, inputFormat fields with duplicate
 *   and empty names, workflow variables of every type, emoji/RTL/CJK block names, CRLF inside
 *   stored text, agent MCP and workflow-as-tool entries, and stored types the registry does not
 *   know (retired and custom blocks), which must still print and compile.
 *
 * {@link generateRejectedCorpus} holds the stored shapes source cannot express: each must fail to
 * compile with its named diagnostic instead of round-tripping.
 *
 * Deterministic: each case draws from a PRNG seeded by `(seed, case id)`, so the corpus is the
 * same on every machine and adding a block does not reshuffle the others.
 */

import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import {
  type BlockFixture,
  buildBlockFixture,
  isOnSurface,
  isStandaloneAdvanced,
  isVisible,
  type PairMode,
} from '@/lib/workflows/code/corpus/blocks'
import { createSeededRandom, type SeededRandom } from '@/lib/workflows/code/corpus/random'
import {
  CORPUS_START_NAME,
  CORPUS_TEXT,
  CORPUS_VARIABLE_NAME,
  resolveOptions,
} from '@/lib/workflows/code/corpus/values'
import { hasTriggerCapability } from '@/lib/workflows/triggers/utils'
import { getBlockRegistry } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import type { BlockState, Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'

type CorpusCaseKind =
  | 'operation'
  | 'trigger'
  | 'standalone-advanced'
  | 'error-edge'
  | 'branches'
  | 'name-collision'
  | 'subflow'
  | 'input-format'
  | 'variables'
  | 'unknown-type'
  | 'shape'
  | 'unicode-names'
  | 'crlf-text'
  | 'agent-tools'
  | 'legacy-scalars'

export interface CorpusCase {
  /** Stable and unique: `<kind>:<block type>:<detail>`. */
  id: string
  kind: CorpusCaseKind
  /** Every block type in `state`, sorted, for per-type parity. */
  blockTypes: string[]
  state: WorkflowState
  /**
   * True for cases whose types the registry does not know. They still must print and compile,
   * but `validateWorkflowState` rejects them by design.
   */
  unknownTypes?: true
  /**
   * A stored shape the editor's write-time validators refuse but real workflows hold:
   * `implicit-branch-handle` is an edge on `condition-<blockId>-if` while the rows were never
   * persisted. `legacy-scalar-text` is a switch or slider holding the text registry defaults once
   * seeded (`'true'`, `'0.7'`), which the switch validator now refuses.
   */
  storedQuirk?: 'implicit-branch-handle' | 'legacy-scalar-text'
}

interface CorpusOptions {
  seed?: number
  /** Defaults to every registered block type, legacy versions included. */
  blocks?: BlockConfig[]
}

/** The seed every generated corpus and fuzz sample uses unless a caller passes its own. */
export const DEFAULT_CORPUS_SEED = 20261115

function hashString(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Accumulates one case's blocks, edges and subflows with ids from the case's PRNG. */
class CaseBuilder {
  readonly rng: SeededRandom
  readonly blocks: Record<string, BlockState> = {}
  readonly edges: WorkflowState['edges'] = []
  readonly loops: Record<string, Loop> = {}
  readonly parallels: Record<string, Parallel> = {}
  private column = 0

  constructor(
    seed: number,
    readonly id: string
  ) {
    this.rng = createSeededRandom((seed ^ hashString(id)) >>> 0)
  }

  newId = (): string => this.rng.uuid()

  nextPosition() {
    this.column += 1
    return { x: this.column * 320, y: 0 }
  }

  add(block: BlockState): string {
    this.blocks[block.id] = block
    const parentId = block.data?.parentId
    if (parentId) {
      const container = this.loops[parentId] ?? this.parallels[parentId]
      container?.nodes.push(block.id)
    }
    return block.id
  }

  connect(source: string, target: string, sourceHandle = 'source') {
    this.edges.push({
      id: this.newId(),
      source,
      target,
      sourceHandle,
      targetHandle: 'target',
      type: 'default',
      data: {},
    })
  }

  build(
    kind: CorpusCaseKind,
    extras: Pick<CorpusCase, 'unknownTypes' | 'storedQuirk'> = {},
    { withVariable = true }: { withVariable?: boolean } = {}
  ): CorpusCase {
    const variableId = withVariable ? this.newId() : null
    const state: WorkflowState = {
      blocks: this.blocks,
      edges: this.edges,
      loops: this.loops,
      parallels: this.parallels,
      variables: variableId
        ? {
            [variableId]: {
              id: variableId,
              name: CORPUS_VARIABLE_NAME,
              type: 'string',
              value: CORPUS_TEXT,
            },
          }
        : {},
    }
    const blockTypes = [...new Set(Object.values(this.blocks).map((b) => b.type))].sort()
    return { id: this.id, kind, blockTypes, state, ...extras }
  }
}

interface Registry {
  byType: Map<string, BlockConfig>
  toolType: { type: string; operations: string[] } | null
}

function operationsOf(config: BlockConfig): string[] {
  const operation = config.subBlocks.find((s) => s.id === 'operation' && s.type === 'dropdown')
  if (!operation) return []
  return (resolveOptions(operation, {}) ?? []).map((option) => option.id)
}

function startBlock(builder: CaseBuilder, registry: Registry, inputFormat?: unknown[]): string {
  const config = registry.byType.get('start_trigger')
  if (!config) throw new Error('The registry has no start_trigger block')
  const fixture = buildBlockFixture({
    config,
    id: builder.newId(),
    name: CORPUS_START_NAME,
    rng: builder.rng,
    newId: builder.newId,
    toolType: registry.toolType,
    triggerMode: false,
    pairMode: 'basic',
    advancedMode: false,
    position: { x: 0, y: 0 },
  })
  const inputFormatState = fixture.block.subBlocks.inputFormat
  if (inputFormat && inputFormatState) {
    inputFormatState.value = inputFormat as typeof inputFormatState.value
  }
  return builder.add(fixture.block)
}

interface SubjectOptions {
  triggerMode?: boolean
  operation?: string
  triggerId?: string
  pairMode?: PairMode
  advancedMode?: boolean
  fillStandaloneAdvanced?: boolean
  parentId?: string
  name?: string
}

function subject(
  builder: CaseBuilder,
  registry: Registry,
  config: BlockConfig,
  options: SubjectOptions = {}
): BlockFixture {
  const fixture = buildBlockFixture({
    config,
    id: builder.newId(),
    name: options.name ?? config.name,
    rng: builder.rng,
    newId: builder.newId,
    toolType: registry.toolType,
    triggerMode: options.triggerMode ?? false,
    operation: options.operation,
    triggerId: options.triggerId,
    pairMode: options.pairMode ?? 'basic',
    advancedMode: options.advancedMode ?? false,
    fillStandaloneAdvanced: options.fillStandaloneAdvanced,
    parentId: options.parentId,
    position: builder.nextPosition(),
  })
  builder.add(fixture.block)
  return fixture
}

/** Whether nothing may connect into blocks of this config in this mode. */
function isTriggerOnly(config: BlockConfig, triggerMode: boolean): boolean {
  return triggerMode || config.category === 'triggers'
}

function canConnect(config: BlockConfig): boolean {
  return config.type !== 'note'
}

function hasVisiblePair(
  config: BlockConfig,
  operation: string | undefined,
  triggerSurface: boolean
) {
  const values = operation === undefined ? {} : { operation }
  const counts = new Map<string, number>()
  for (const subBlock of config.subBlocks) {
    if (!subBlock.canonicalParamId) continue
    if (!isOnSurface(subBlock, config, triggerSurface) || !isVisible(subBlock, values)) continue
    counts.set(subBlock.canonicalParamId, (counts.get(subBlock.canonicalParamId) ?? 0) + 1)
  }
  return [...counts.values()].some((n) => n > 1)
}

function blockCases(config: BlockConfig, registry: Registry, seed: number): CorpusCase[] {
  const cases: CorpusCase[] = []
  const type = config.type

  const singleCase = (
    kind: CorpusCaseKind,
    detail: string,
    options: SubjectOptions,
    after?: (builder: CaseBuilder, subjectId: string) => void
  ) => {
    const builder = new CaseBuilder(seed, `${kind}:${type}:${detail}`)
    // The Start block is single-instance: a start_trigger subject is the case's only Start.
    const start = type === 'start_trigger' ? null : startBlock(builder, registry)
    const { block } = subject(builder, registry, config, options)
    if (start && !isTriggerOnly(config, options.triggerMode ?? false) && canConnect(config)) {
      builder.connect(start, block.id)
    }
    after?.(builder, block.id)
    cases.push(builder.build(kind))
  }

  if (config.category !== 'triggers' && type !== 'start_trigger') {
    const operations = operationsOf(config)
    const opList: Array<string | undefined> = operations.length > 0 ? operations : [undefined]
    for (const operation of opList) {
      const detail = operation ?? 'default'
      singleCase('operation', `${detail}:basic`, { operation, pairMode: 'basic' })
      if (hasVisiblePair(config, operation, false)) {
        singleCase('operation', `${detail}:advanced`, {
          operation,
          pairMode: 'advanced',
          advancedMode: true,
        })
      }
    }

    const standaloneOperation = opList.find((operation) =>
      config.subBlocks.some(
        (s) =>
          isStandaloneAdvanced(s) &&
          isOnSurface(s, config, false) &&
          isVisible(s, operation === undefined ? {} : { operation })
      )
    )
    if (
      standaloneOperation !== undefined ||
      (opList[0] === undefined && config.subBlocks.some(isStandaloneAdvanced))
    ) {
      singleCase('standalone-advanced', standaloneOperation ?? 'default', {
        operation: standaloneOperation,
        advancedMode: false,
        fillStandaloneAdvanced: true,
      })
    }

    if (canConnect(config) && config.type !== 'loop' && config.type !== 'parallel') {
      const functionConfig = registry.byType.get('function')
      singleCase('error-edge', opList[0] ?? 'default', { operation: opList[0] }, (builder, id) => {
        if (!functionConfig) return
        const handler = subject(builder, registry, functionConfig, { name: 'On Error' })
        builder.connect(id, handler.block.id, 'error')
      })
    }
  }

  if (hasTriggerCapability(config) || config.category === 'triggers') {
    const triggerIds = config.triggers?.available?.length ? config.triggers.available : [undefined]
    const dualMode = config.category !== 'triggers'
    triggerIds.forEach((triggerId, i) => {
      const detail = triggerId ?? 'default'
      singleCase('trigger', `${detail}:basic`, {
        triggerMode: dualMode,
        triggerId,
        pairMode: 'basic',
      })
      if (i === 0 && hasVisiblePair(config, undefined, true)) {
        singleCase('trigger', `${detail}:advanced`, {
          triggerMode: dualMode,
          triggerId,
          pairMode: 'advanced',
          advancedMode: true,
        })
      }
    })
  }

  return cases
}

type BranchRow = { id: string; title: string; value: string }

function rowsJson(rows: BranchRow[], asArray = false) {
  return asArray ? rows : JSON.stringify(rows)
}

/** `count` condition rows: `if`, `count - 2` × `else if`, `else`. */
function manyConditionRows(builder: CaseBuilder, count: number): BranchRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: builder.newId(),
    title: i === 0 ? 'if' : i === count - 1 ? 'else' : 'else if',
    value: i === count - 1 ? '' : `<start.input> > ${i * 10}`,
  }))
}

/**
 * Condition rows after the editor moved them (`moveBlock` in condition-input.tsx): every row but
 * `else` reversed, `else` pinned last, and titles recomputed by position. Edges and targets keep
 * their creation order.
 */
function reorderedConditionRows(rows: BranchRow[]): BranchRow[] {
  const elseRow = rows[rows.length - 1]
  const moved = rows.slice(0, -1).reverse()
  const ordered = elseRow ? [...moved, elseRow] : moved
  return ordered.map((row, i) => ({
    ...row,
    title: i === 0 ? 'if' : i === ordered.length - 1 ? 'else' : 'else if',
  }))
}

function branchCases(registry: Registry, seed: number): CorpusCase[] {
  const cases: CorpusCase[] = []
  const condition = registry.byType.get('condition')
  const router = registry.byType.get('router_v2')
  const fn = registry.byType.get('function')
  if (!fn) return cases

  const conditionCase = (
    detail: string,
    makeRows: (b: CaseBuilder) => BranchRow[] | null,
    options: { asArray?: boolean; reorder?: boolean } = {}
  ) => {
    if (!condition) return
    const builder = new CaseBuilder(seed, `branches:condition:${detail}`)
    const start = startBlock(builder, registry)
    const { block } = subject(builder, registry, condition, { name: 'Decide' })
    builder.connect(start, block.id)
    const rows = makeRows(builder)
    const targets = rows ?? [{ id: `${block.id}-if`, title: 'if', value: '' }]
    targets.forEach((row, i) => {
      const target = subject(builder, registry, fn, { name: `Branch ${i}` })
      builder.connect(block.id, target.block.id, `condition-${row.id}`)
    })
    const stored = rows && options.reorder ? reorderedConditionRows(rows) : rows
    const conditions = block.subBlocks.conditions
    if (conditions) {
      conditions.value = (
        stored === null ? null : rowsJson(stored, options.asArray)
      ) as typeof conditions.value
    }
    cases.push(
      builder.build('branches', rows === null ? { storedQuirk: 'implicit-branch-handle' } : {})
    )
  }

  conditionCase('three-branches', (b) => [
    { id: b.newId(), title: 'if', value: '<start.input> > 10' },
    { id: b.newId(), title: 'else if', value: "<start.name> === 'a`b\u0024{c}'" },
    { id: b.newId(), title: 'else if', value: '<start.input> <3' },
    { id: b.newId(), title: 'else', value: '' },
  ])
  conditionCase('title-overrides', (b) => [
    { id: b.newId(), title: 'If big', value: '<start.input> > 10' },
    { id: b.newId(), title: 'Otherwise maybe', value: '<start.input> > 5' },
    { id: b.newId(), title: 'Fallback', value: '' },
  ])
  conditionCase('null-rows', () => null)
  conditionCase('seven-branches', (b) => manyConditionRows(b, 7))
  conditionCase('seven-branches-reordered', (b) => manyConditionRows(b, 7), { reorder: true })
  conditionCase(
    'array-encoded',
    (b) => [
      { id: b.newId(), title: 'if', value: '<start.input>' },
      { id: b.newId(), title: 'else', value: '' },
    ],
    { asArray: true }
  )

  const routerCase = (
    detail: string,
    rows: ((b: CaseBuilder) => BranchRow[]) | null,
    options: { reorder?: boolean } = {}
  ) => {
    if (!router) return
    const builder = new CaseBuilder(seed, `branches:router_v2:${detail}`)
    const start = startBlock(builder, registry)
    const { block } = subject(builder, registry, router, { name: 'Pick Route' })
    builder.connect(start, block.id)
    const routeRows = rows ? rows(builder) : null
    for (const [i, row] of (routeRows ?? []).entries()) {
      const target = subject(builder, registry, fn, { name: `Route Target ${i}` })
      builder.connect(block.id, target.block.id, `router-${row.id}`)
    }
    // Router titles are user text, so a reorder moves rows without renaming them.
    const stored = routeRows && options.reorder ? [...routeRows].reverse() : routeRows
    const routes = block.subBlocks.routes
    if (routes)
      routes.value = (stored === null ? null : JSON.stringify(stored)) as typeof routes.value
    cases.push(builder.build('branches'))
  }

  routerCase('three-routes', (b) => [
    { id: b.newId(), title: 'Route 1', value: CORPUS_TEXT },
    { id: b.newId(), title: 'Route 2', value: 'Billing questions' },
    { id: b.newId(), title: 'Route 3', value: 'Everything else' },
  ])
  routerCase('title-overrides', (b) => [
    { id: b.newId(), title: 'Sales', value: 'Pricing and plans' },
    { id: b.newId(), title: 'Support', value: CORPUS_TEXT },
  ])
  routerCase('null-rows', null)
  const sixRoutes = (b: CaseBuilder) =>
    ['Sales', 'Support', 'Billing', 'Legal', 'Security', 'Everything else'].map((title, i) => ({
      id: b.newId(),
      title,
      value: i === 0 ? CORPUS_TEXT : `${title} questions`,
    }))
  routerCase('six-routes', sixRoutes)
  routerCase('six-routes-reordered', sixRoutes, { reorder: true })

  return cases
}

function collisionCases(registry: Registry, seed: number): CorpusCase[] {
  const fn = registry.byType.get('function')
  if (!fn) return []
  const pairs: Array<[string, string]> = [
    ['Agent 1', 'agent1'],
    ['My.Block', 'myblock'],
    ['Fetch  Data', 'fetch data'],
  ]
  return pairs.map(([a, b]) => {
    const builder = new CaseBuilder(seed, `name-collision:function:${a}|${b}`)
    const start = startBlock(builder, registry)
    const first = subject(builder, registry, fn, { name: a })
    const second = subject(builder, registry, fn, { name: b })
    builder.connect(start, first.block.id)
    builder.connect(first.block.id, second.block.id)
    return builder.build('name-collision')
  })
}

type ContainerSpec =
  | { kind: 'loop'; loopType: Loop['loopType'] }
  | { kind: 'parallel'; parallelType: 'count' | 'collection' }

function containerBlock(
  builder: CaseBuilder,
  spec: ContainerSpec,
  name: string,
  parentId?: string,
  enabled = true
): string {
  const id = builder.newId()
  const parent = parentId ? { parentId, extent: 'parent' as const } : {}
  if (spec.kind === 'loop') {
    const { loopType } = spec
    const forEachItems = loopType === 'forEach' ? '<start.input>' : ''
    const whileCondition = loopType === 'while' ? '<loop.index> <3' : ''
    const doWhileCondition = loopType === 'doWhile' ? '<loop.index> < 5' : ''
    builder.loops[id] = {
      id,
      nodes: [],
      iterations: 4,
      loopType,
      forEachItems,
      whileCondition,
      doWhileCondition,
      enabled,
    }
    builder.add({
      id,
      type: 'loop',
      name,
      position: builder.nextPosition(),
      subBlocks: {},
      outputs: {},
      enabled,
      data: {
        ...parent,
        width: 500,
        height: 300,
        type: 'subflowNode',
        loopType,
        count: 4,
        collection: forEachItems,
        whileCondition,
        doWhileCondition,
      },
    })
  } else {
    const { parallelType } = spec
    const distribution = parallelType === 'collection' ? '<start.input>' : ''
    builder.parallels[id] = {
      id,
      nodes: [],
      count: 3,
      distribution,
      parallelType,
      batchSize: 2,
      enabled,
    }
    builder.add({
      id,
      type: 'parallel',
      name,
      position: builder.nextPosition(),
      subBlocks: {},
      outputs: {},
      enabled,
      data: {
        ...parent,
        width: 500,
        height: 300,
        type: 'subflowNode',
        parallelType,
        count: 3,
        collection: distribution,
        batchSize: 2,
      },
    })
  }
  return id
}

function subflowCases(registry: Registry, seed: number): CorpusCase[] {
  const fn = registry.byType.get('function')
  if (!fn) return []
  const specs: Array<{ detail: string; chain: ContainerSpec[] }> = [
    { detail: 'loop-for', chain: [{ kind: 'loop', loopType: 'for' }] },
    { detail: 'loop-forEach', chain: [{ kind: 'loop', loopType: 'forEach' }] },
    { detail: 'loop-while', chain: [{ kind: 'loop', loopType: 'while' }] },
    { detail: 'loop-doWhile', chain: [{ kind: 'loop', loopType: 'doWhile' }] },
    { detail: 'parallel-count', chain: [{ kind: 'parallel', parallelType: 'count' }] },
    { detail: 'parallel-collection', chain: [{ kind: 'parallel', parallelType: 'collection' }] },
    {
      detail: 'loop-in-parallel',
      chain: [
        { kind: 'parallel', parallelType: 'collection' },
        { kind: 'loop', loopType: 'forEach' },
      ],
    },
    {
      detail: 'parallel-in-loop',
      chain: [
        { kind: 'loop', loopType: 'for' },
        { kind: 'parallel', parallelType: 'count' },
      ],
    },
    {
      detail: 'loop-in-loop',
      chain: [
        { kind: 'loop', loopType: 'while' },
        { kind: 'loop', loopType: 'doWhile' },
      ],
    },
    {
      detail: 'loop-parallel-loop',
      chain: [
        { kind: 'loop', loopType: 'forEach' },
        { kind: 'parallel', parallelType: 'collection' },
        { kind: 'loop', loopType: 'for' },
      ],
    },
  ]

  return specs.map(({ detail, chain }) => {
    const builder = new CaseBuilder(seed, `subflow:${chain.map((c) => c.kind).join('>')}:${detail}`)
    const start = startBlock(builder, registry)
    let parentId: string | undefined
    let upstream = start
    let upstreamHandle = 'source'
    const containers: string[] = []
    chain.forEach((spec, depth) => {
      const id = containerBlock(builder, spec, `${spec.kind} ${depth}`, parentId)
      builder.connect(upstream, id, upstreamHandle)
      containers.push(id)
      parentId = id
      upstream = id
      upstreamHandle = `${spec.kind}-start-source`
    })
    const body = subject(builder, registry, fn, { name: 'Body', parentId })
    builder.connect(upstream, body.block.id, upstreamHandle)
    const second = subject(builder, registry, fn, { name: 'Body Two', parentId })
    builder.connect(body.block.id, second.block.id)
    const outer = containers[0]
    const outerSpec = chain[0]
    if (outer && outerSpec) {
      const after = subject(builder, registry, fn, { name: 'After Subflow' })
      builder.connect(outer, after.block.id, `${outerSpec.kind}-end-source`)
    }
    return builder.build('subflow')
  })
}

/**
 * Container edges whose handle does not match where the target sits, which the canvas never draws
 * but stored workflows hold (the editing engine keeps a start edge to a block extracted from the
 * container): a loop's start handle to a block outside it, the only edge between them, which the
 * executor runs as the loop's exit; and a parallel's end handle into its own child. Source writes
 * both as `edge()` with W_SUBFLOW_HANDLE_SCOPE.
 */
function mismatchedHandleCases(registry: Registry, seed: number): CorpusCase[] {
  const fn = registry.byType.get('function')
  if (!fn) return []
  return (['loop', 'parallel'] as const).map((kind) => {
    const builder = new CaseBuilder(seed, `subflow:${kind}:mismatched-handle`)
    const start = startBlock(builder, registry)
    const spec: ContainerSpec =
      kind === 'loop' ? { kind, loopType: 'for' } : { kind, parallelType: 'count' }
    const container = containerBlock(builder, spec, `${kind} 0`)
    builder.connect(start, container)
    const body = subject(builder, registry, fn, { name: 'Body', parentId: container })
    const outside = subject(builder, registry, fn, { name: 'Outside' })
    if (kind === 'loop') {
      builder.connect(container, body.block.id, 'loop-start-source')
      builder.connect(container, outside.block.id, 'loop-start-source')
    } else {
      builder.connect(container, outside.block.id, 'parallel-end-source')
      builder.connect(container, body.block.id, 'parallel-end-source')
    }
    return builder.build('subflow')
  })
}

function inputFormatCases(registry: Registry, seed: number): CorpusCase[] {
  const builder = new CaseBuilder(seed, 'input-format:start_trigger:duplicate-and-empty-names')
  const field = (name: string, type: string) => ({
    id: builder.newId(),
    name,
    type,
    value: '',
    collapsed: false,
  })
  startBlock(builder, registry, [
    field('query', 'string'),
    field('query', 'number'),
    field('', 'string'),
    field('', 'object'),
    field('weird name.with dots', 'string'),
  ])
  return [builder.build('input-format')]
}

function variableCases(registry: Registry, seed: number): CorpusCase[] {
  const builder = new CaseBuilder(seed, 'variables:variables:every-type')
  const start = startBlock(builder, registry)
  const variablesBlock = registry.byType.get('variables')
  if (variablesBlock) {
    const { block } = subject(builder, registry, variablesBlock)
    builder.connect(start, block.id)
  }
  const built = builder.build('variables')
  const extra: Array<[string, NonNullable<WorkflowState['variables']>[string]['type'], unknown]> = [
    ['count', 'number', 3],
    ['flag', 'boolean', false],
    ['payload', 'object', { text: CORPUS_TEXT }],
    ['items', 'array', ['<start.input>', 2]],
    ['raw', 'plain', CORPUS_TEXT],
    ['Count', 'string', 'case collision with count'],
  ]
  for (const [name, type, value] of extra) {
    const id = builder.newId()
    built.state.variables = { ...built.state.variables, [id]: { id, name, type, value } }
  }
  return [built]
}

/** Every subflow kind, for one workflow that holds them all. */
const EVERY_CONTAINER: ContainerSpec[] = [
  { kind: 'loop', loopType: 'for' },
  { kind: 'loop', loopType: 'forEach' },
  { kind: 'loop', loopType: 'while' },
  { kind: 'loop', loopType: 'doWhile' },
  { kind: 'parallel', parallelType: 'count' },
  { kind: 'parallel', parallelType: 'collection' },
]

/**
 * Whole-workflow shapes: an empty workflow, notes only (no Start), disabled containers as the
 * editor's `batchToggleEnabled` leaves them (the container and its descendants, then one child
 * re-enabled), a condition inside a parallel inside a loop, and every subflow kind in one
 * workflow.
 */
function shapeCases(registry: Registry, seed: number): CorpusCase[] {
  const fn = registry.byType.get('function')
  const note = registry.byType.get('note')
  const condition = registry.byType.get('condition')
  if (!fn || !note || !condition) return []
  const cases: CorpusCase[] = []

  cases.push(
    new CaseBuilder(seed, 'shape:empty:zero-blocks').build('shape', {}, { withVariable: false })
  )

  const notes = new CaseBuilder(seed, 'shape:note:notes-only')
  subject(notes, registry, note, { name: 'Read Me' })
  subject(notes, registry, note, { name: 'Read Me Too' })
  cases.push(notes.build('shape'))

  const disabledCase = (detail: string, spec: ContainerSpec, reenableSecondChild: boolean) => {
    const builder = new CaseBuilder(seed, `shape:${spec.kind}:${detail}`)
    const start = startBlock(builder, registry)
    const container = containerBlock(builder, spec, `Disabled ${spec.kind}`, undefined, false)
    builder.connect(start, container)
    const first = subject(builder, registry, fn, { name: 'Body', parentId: container })
    const second = subject(builder, registry, fn, { name: 'Body Two', parentId: container })
    first.block.enabled = false
    second.block.enabled = reenableSecondChild
    builder.connect(container, first.block.id, `${spec.kind}-start-source`)
    builder.connect(first.block.id, second.block.id)
    const after = subject(builder, registry, fn, { name: 'After Subflow' })
    builder.connect(container, after.block.id, `${spec.kind}-end-source`)
    cases.push(builder.build('shape'))
  }
  disabledCase('disabled-cascade', { kind: 'loop', loopType: 'for' }, false)
  disabledCase('disabled-child-reenabled', { kind: 'parallel', parallelType: 'count' }, true)

  const nested = new CaseBuilder(seed, 'shape:loop>parallel>condition:nested-branches')
  const nestedStart = startBlock(nested, registry)
  const loop = containerBlock(nested, { kind: 'loop', loopType: 'forEach' }, 'Outer Loop')
  nested.connect(nestedStart, loop)
  const parallel = containerBlock(
    nested,
    { kind: 'parallel', parallelType: 'collection' },
    'Inner Parallel',
    loop
  )
  nested.connect(loop, parallel, 'loop-start-source')
  const decide = subject(nested, registry, condition, { name: 'Decide', parentId: parallel })
  nested.connect(parallel, decide.block.id, 'parallel-start-source')
  const rows: BranchRow[] = [
    { id: nested.newId(), title: 'if', value: '<parallel.currentItem> > <loop.index>' },
    { id: nested.newId(), title: 'else', value: '' },
  ]
  const conditions = decide.block.subBlocks.conditions
  if (conditions) conditions.value = rowsJson(rows) as typeof conditions.value
  rows.forEach((row, i) => {
    const target = subject(nested, registry, fn, { name: `Branch ${i}`, parentId: parallel })
    nested.connect(decide.block.id, target.block.id, `condition-${row.id}`)
  })
  const afterLoop = subject(nested, registry, fn, { name: 'After Loop' })
  nested.connect(loop, afterLoop.block.id, 'loop-end-source')
  cases.push(nested.build('shape'))

  const every = new CaseBuilder(seed, 'shape:loop>parallel:every-subflow-kind')
  let upstream = startBlock(every, registry)
  let upstreamHandle = 'source'
  EVERY_CONTAINER.forEach((spec, i) => {
    const container = containerBlock(every, spec, `${spec.kind} ${i}`)
    every.connect(upstream, container, upstreamHandle)
    const body = subject(every, registry, fn, { name: `Body ${i}`, parentId: container })
    every.connect(container, body.block.id, `${spec.kind}-start-source`)
    upstream = container
    upstreamHandle = `${spec.kind}-end-source`
  })
  const last = subject(every, registry, fn, { name: 'After Every Subflow' })
  every.connect(upstream, last.block.id, upstreamHandle)
  cases.push(every.build('shape'))

  return cases
}

/**
 * Block names in emoji (a ZWJ sequence and a flag), right-to-left scripts and CJK. Each block's
 * code reads the previous block by its normalized key, so references cross those names too.
 */
const UNICODE_NAMES = [
  '🚀 Launch',
  '👩‍💻 Dev Team',
  '🇯🇵 Flag',
  'مرحبا بالعالم',
  'שלום 2',
  '数据处理',
  'データ 変換',
  '한국어 블록',
]

function unicodeNameCases(registry: Registry, seed: number): CorpusCase[] {
  const fn = registry.byType.get('function')
  if (!fn) return []
  const builder = new CaseBuilder(seed, 'unicode-names:function:emoji-rtl-cjk')
  let upstream = startBlock(builder, registry)
  let upstreamKey = 'start'
  for (const name of UNICODE_NAMES) {
    const { block } = subject(builder, registry, fn, { name })
    const code = block.subBlocks.code
    if (code) code.value = `const previous = <${upstreamKey}.result>\nreturn { previous }`
    builder.connect(upstream, block.id)
    upstream = block.id
    upstreamKey = normalizeWorkflowBlockName(name)
  }
  return [builder.build('unicode-names')]
}

/** {@link CORPUS_TEXT} as a Windows editor or `core.autocrlf` stores it, plus a lone CR. */
export const CORPUS_CRLF_TEXT = `${CORPUS_TEXT.replaceAll('\n', '\r\n')}\rlone carriage return`

/** CRLF inside stored text: function code, a note and a variable value. */
function crlfCases(registry: Registry, seed: number): CorpusCase[] {
  const fn = registry.byType.get('function')
  const note = registry.byType.get('note')
  if (!fn || !note) return []
  const builder = new CaseBuilder(seed, 'crlf-text:function:stored-crlf')
  const start = startBlock(builder, registry)
  const { block } = subject(builder, registry, fn, { name: 'Windows Code' })
  const code = block.subBlocks.code
  if (typeof code?.value === 'string') code.value = code.value.replaceAll('\n', '\r\n')
  builder.connect(start, block.id)
  const memo = subject(builder, registry, note, { name: 'Windows Note' })
  const content = memo.block.subBlocks.content
  if (content) content.value = CORPUS_CRLF_TEXT
  const built = builder.build('crlf-text')
  for (const variable of Object.values(built.state.variables ?? {})) {
    variable.value = CORPUS_CRLF_TEXT
  }
  return [built]
}

/**
 * Agent tool entries the editor's tool picker writes (tool-input.tsx): an MCP server tool with its
 * input schema snapshot, a deployed workflow as a tool (`workflow_input`), a block operation as a
 * tool (Slack send to a picked channel) and a workspace custom tool by id.
 */
function agentToolCases(registry: Registry, seed: number): CorpusCase[] {
  const agent = registry.byType.get('agent')
  if (!agent) return []
  const toolCase = (detail: string, makeTools: (b: CaseBuilder) => unknown[]) => {
    const builder = new CaseBuilder(seed, `agent-tools:agent:${detail}`)
    const start = startBlock(builder, registry)
    const { block } = subject(builder, registry, agent, { name: 'Agent' })
    const tools = block.subBlocks.tools
    if (tools) tools.value = makeTools(builder) as typeof tools.value
    builder.connect(start, block.id)
    return builder.build('agent-tools')
  }
  const mcpTool = (b: CaseBuilder, serverId = b.newId()) => {
    return {
      type: 'mcp',
      title: 'search_docs',
      toolId: `mcp-${serverId}-search_docs`,
      params: {
        serverId,
        serverUrl: 'https://mcp.example.com/mcp',
        toolName: 'search_docs',
        serverName: 'Docs Server',
      },
      isExpanded: false,
      usageControl: 'auto',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for' },
          limit: { type: 'number', description: 'Most results to return' },
        },
        required: ['query'],
        description: 'Search the documentation',
      },
    }
  }
  const workflowTool = (b: CaseBuilder, workflowId = b.newId()) => ({
    type: 'workflow_input',
    title: 'Workflow',
    toolId: 'workflow_executor',
    params: { workflowId },
    isExpanded: false,
    usageControl: 'auto',
  })
  const builderTool = () => ({
    type: 'slack_v2',
    title: 'Slack',
    operation: 'send',
    params: { channel: 'corpus-pick-1', text: CORPUS_TEXT },
    isExpanded: false,
    usageControl: 'auto',
  })
  const customTool = () => ({
    type: 'custom-tool',
    customToolId: 'corpus-custom-tool',
    usageControl: 'auto',
  })
  return [
    toolCase('mcp', (b) => [mcpTool(b)]),
    toolCase('workflow-input', (b) => [workflowTool(b)]),
    toolCase('mcp-and-workflow-input', (b) => [mcpTool(b), workflowTool(b)]),
    toolCase('builder-and-custom', () => [builderTool(), customTool()]),
    toolCase('every-kind', (b) => [
      builderTool(),
      customTool(),
      mcpTool(b, 'corpus-mcp-server'),
      workflowTool(b, 'corpus-workflow'),
    ]),
  ]
}

/** A switch or slider value as registry defaults once seeded it: `'true'`, `'0.7'`, `'1.0'`. */
function legacyText(value: unknown): unknown {
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return Number.isInteger(value) ? value.toFixed(1) : String(value)
  return value
}

/** Switch and slider ids another field's object condition reads (`{ field: 'x', value: true }`). */
function gatingScalarIds(config: BlockConfig, scalarIds: ReadonlySet<string>): Set<string> {
  const gating = new Set<string>()
  for (const subBlock of config.subBlocks) {
    const condition = subBlock.condition
    if (!condition || typeof condition === 'function') continue
    for (const field of [condition.field, condition.and?.field]) {
      if (field && scalarIds.has(field)) gating.add(field)
    }
  }
  return gating
}

/**
 * Workflows stored before switch and slider defaults were seeded typed, every switch and slider
 * holding its old text form. Per block type: the first operation that stores a seeded switch or
 * slider, and the first that stores a switch another field's condition reads, held at `'true'`
 * (the text visibility compares strictly, so it must not read as `true`). A case holding such a
 * switch ends in `:gating-text`: its text stays text, so it prints as a string.
 */
function legacyScalarCases(configs: BlockConfig[], registry: Registry, seed: number): CorpusCase[] {
  const cases: CorpusCase[] = []
  for (const config of configs) {
    if (config.category === 'triggers') continue
    const scalars = config.subBlocks.filter((s) => s.type === 'switch' || s.type === 'slider')
    const scalarIds = new Set(scalars.map((s) => s.id))
    const gating = gatingScalarIds(config, scalarIds)
    const targets = [
      new Set(scalars.filter((s) => s.value !== undefined).map((s) => s.id)),
      gating,
    ].filter((ids) => ids.size > 0)
    const operations = operationsOf(config)
    const used = new Set<string>()
    for (const target of targets) {
      for (const operation of operations.length > 0 ? operations : [undefined]) {
        const detail = operation ?? 'default'
        if (used.has(detail)) continue
        const builder = new CaseBuilder(seed, `legacy-scalars:${config.type}:${detail}`)
        const start = startBlock(builder, registry)
        const { block } = subject(builder, registry, config, { operation })
        let hit = false
        let gatingText = false
        for (const [id, stored] of Object.entries(block.subBlocks)) {
          if (!stored || !scalarIds.has(id) || typeof stored.value === 'string') continue
          const text = gating.has(id) ? 'true' : legacyText(stored.value)
          if (typeof text !== 'string') continue
          stored.value = text
          if (target.has(id)) hit = true
          if (gating.has(id)) gatingText = true
        }
        if (!hit) continue
        used.add(detail)
        if (canConnect(config)) builder.connect(start, block.id)
        const built = builder.build('legacy-scalars', { storedQuirk: 'legacy-scalar-text' })
        cases.push(gatingText ? { ...built, id: `${built.id}:gating-text` } : built)
        break
      }
    }
  }
  return cases
}

function unknownTypeCases(registry: Registry, seed: number): CorpusCase[] {
  return ['retired_block_corpus', 'custom_block_corpus-slug'].map((type) => {
    const builder = new CaseBuilder(seed, `unknown-type:${type}:stored`)
    const start = startBlock(builder, registry)
    const id = builder.newId()
    builder.add({
      id,
      type,
      name: 'Mystery Block',
      position: builder.nextPosition(),
      subBlocks: {
        prompt: { id: 'prompt', type: 'long-input', value: CORPUS_TEXT },
        mode: { id: 'mode', type: 'dropdown', value: 'fast' },
        count: { id: 'count', type: 'slider', value: 3 },
        empty: { id: 'empty', type: 'short-input', value: '' },
        cleared: { id: 'cleared', type: 'short-input', value: null },
      },
      outputs: { result: { type: 'string', description: 'Result' } },
      enabled: true,
      data: { someUnknownKey: 'kept verbatim' } as BlockState['data'],
    })
    builder.connect(start, id)
    return builder.build('unknown-type', { unknownTypes: true })
  })
}

function buildRegistry(options: CorpusOptions): { configs: BlockConfig[]; registry: Registry } {
  const configs = options.blocks ?? Object.values(getBlockRegistry())
  const all = Object.values(getBlockRegistry())
  const byType = new Map(all.map((config) => [config.type, config]))
  for (const config of configs) byType.set(config.type, config)

  const toolCandidate =
    byType.get('slack') ??
    all.find((config) => config.tools.access.length > 0 && operationsOf(config).length > 1)
  return {
    configs,
    registry: {
      byType,
      toolType: toolCandidate
        ? { type: toolCandidate.type, operations: operationsOf(toolCandidate) }
        : null,
    },
  }
}

/**
 * Generates the registry corpus. Pure apart from reading the registry: the same seed and the same
 * registry give the same cases in the same order.
 */
export function generateRegistryCorpus(options: CorpusOptions = {}): CorpusCase[] {
  const seed = options.seed ?? DEFAULT_CORPUS_SEED
  const { configs, registry } = buildRegistry(options)
  return [
    ...configs.flatMap((config) => blockCases(config, registry, seed)),
    ...branchCases(registry, seed),
    ...collisionCases(registry, seed),
    ...subflowCases(registry, seed),
    ...mismatchedHandleCases(registry, seed),
    ...shapeCases(registry, seed),
    ...inputFormatCases(registry, seed),
    ...variableCases(registry, seed),
    ...unicodeNameCases(registry, seed),
    ...crlfCases(registry, seed),
    ...agentToolCases(registry, seed),
    ...legacyScalarCases(configs, registry, seed),
    ...unknownTypeCases(registry, seed),
  ]
}

/** A stored shape source cannot express: print and compile must fail with `code`. */
interface RejectedCase {
  id: string
  /** The diagnostic compile must report. */
  code: string
  state: WorkflowState
}

/**
 * Stored shapes the round trip must reject rather than reproduce. An error edge from a loop child
 * to a block outside the loop crosses a subflow scope, which source has no way to write
 * (`E_EDGE_SCOPE`).
 */
export function generateRejectedCorpus(options: CorpusOptions = {}): RejectedCase[] {
  const seed = options.seed ?? DEFAULT_CORPUS_SEED
  const { registry } = buildRegistry(options)
  const fn = registry.byType.get('function')
  if (!fn) return []
  const builder = new CaseBuilder(seed, 'reject:loop:child-error-edge-out')
  const start = startBlock(builder, registry)
  const loop = containerBlock(builder, { kind: 'loop', loopType: 'for' }, 'Loop')
  builder.connect(start, loop)
  const child = subject(builder, registry, fn, { name: 'Body', parentId: loop })
  builder.connect(loop, child.block.id, 'loop-start-source')
  const outside = subject(builder, registry, fn, { name: 'Outside Handler' })
  builder.connect(child.block.id, outside.block.id, 'error')
  const { state } = builder.build('subflow')
  return [{ id: builder.id, code: 'E_EDGE_SCOPE', state }]
}
