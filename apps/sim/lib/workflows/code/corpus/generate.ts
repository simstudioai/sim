/**
 * The generated round-trip corpus over the real block registry (s3 §5 corpus 1, s1 §6). Each case
 * is one stored `WorkflowState` with an upstream `start` trigger. Coverage is pairwise, not
 * cartesian:
 *
 * - every block type × every option of its `operation` dropdown, each in all-basic and (when that
 *   operation shows a canonical pair) all-advanced, the latter with the advanced toggle on;
 * - trigger mode for every trigger the block hosts;
 * - a standalone advanced field holding a value with the advanced toggle off;
 * - an error edge out of every block that can have one;
 * - tool-input lists with two tools of one type (every tool-input field);
 * - structural cases: condition/router title variants, `null` rows and 3+ branches, legacy
 *   normalized-name collisions, every loop and parallel type including nesting, inputFormat
 *   fields with duplicate and empty names, workflow variables, and stored types the registry does
 *   not know (retired and custom blocks), which must still print and compile (contract
 *   amendment 6).
 *
 * Deterministic: each case draws from a PRNG seeded by `(seed, case id)`, so the corpus is the
 * same on every machine and adding a block does not reshuffle the others.
 */

import { createSeededRandom, type SeededRandom } from '@sim/workflow-code/proof'
import {
  type BlockFixture,
  buildBlockFixture,
  isOnSurface,
  isStandaloneAdvanced,
  isVisible,
  type PairMode,
} from '@/lib/workflows/code/corpus/blocks'
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
   * persisted (s1 quirk 7, contract amendment 7).
   */
  storedQuirk?: 'implicit-branch-handle'
}

interface CorpusOptions {
  seed?: number
  /** Defaults to every registered block type, legacy versions included. */
  blocks?: BlockConfig[]
}

const DEFAULT_CORPUS_SEED = 20261115

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
    extras: Pick<CorpusCase, 'unknownTypes' | 'storedQuirk'> = {}
  ): CorpusCase {
    const variableId = this.newId()
    const state: WorkflowState = {
      blocks: this.blocks,
      edges: this.edges,
      loops: this.loops,
      parallels: this.parallels,
      variables: {
        [variableId]: {
          id: variableId,
          name: CORPUS_VARIABLE_NAME,
          type: 'string',
          value: CORPUS_TEXT,
        },
      },
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
    const start = startBlock(builder, registry)
    const { block } = subject(builder, registry, config, options)
    if (!isTriggerOnly(config, options.triggerMode ?? false) && canConnect(config)) {
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

function rowsJson(rows: Array<{ id: string; title: string; value: string }>, asArray = false) {
  return asArray ? rows : JSON.stringify(rows)
}

function branchCases(registry: Registry, seed: number): CorpusCase[] {
  const cases: CorpusCase[] = []
  const condition = registry.byType.get('condition')
  const router = registry.byType.get('router_v2')
  const fn = registry.byType.get('function')
  if (!fn) return cases

  const conditionCase = (
    detail: string,
    makeRows: (b: CaseBuilder) => Array<{ id: string; title: string; value: string }> | null,
    options: { asArray?: boolean; implicitHandle?: boolean } = {}
  ) => {
    if (!condition) return
    const builder = new CaseBuilder(seed, `branches:condition:${detail}`)
    const start = startBlock(builder, registry)
    const { block } = subject(builder, registry, condition, { name: 'Decide' })
    builder.connect(start, block.id)
    const rows = makeRows(builder)
    const conditions = block.subBlocks.conditions
    if (conditions) {
      conditions.value = (
        rows === null ? null : rowsJson(rows, options.asArray)
      ) as typeof conditions.value
    }
    const targets = rows ?? [{ id: `${block.id}-if`, title: 'if', value: '' }]
    targets.forEach((row, i) => {
      const target = subject(builder, registry, fn, { name: `Branch ${i}` })
      builder.connect(block.id, target.block.id, `condition-${row.id}`)
    })
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
    rows: ((b: CaseBuilder) => Array<{ id: string; title: string; value: string }>) | null
  ) => {
    if (!router) return
    const builder = new CaseBuilder(seed, `branches:router_v2:${detail}`)
    const start = startBlock(builder, registry)
    const { block } = subject(builder, registry, router, { name: 'Pick Route' })
    builder.connect(start, block.id)
    const routeRows = rows ? rows(builder) : null
    const routes = block.subBlocks.routes
    if (routes)
      routes.value = (routeRows === null ? null : JSON.stringify(routeRows)) as typeof routes.value
    for (const [i, row] of (routeRows ?? []).entries()) {
      const target = subject(builder, registry, fn, { name: `Route Target ${i}` })
      builder.connect(block.id, target.block.id, `router-${row.id}`)
    }
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
  parentId?: string
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
      enabled: true,
    }
    builder.add({
      id,
      type: 'loop',
      name,
      position: builder.nextPosition(),
      subBlocks: {},
      outputs: {},
      enabled: true,
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
      enabled: true,
    }
    builder.add({
      id,
      type: 'parallel',
      name,
      position: builder.nextPosition(),
      subBlocks: {},
      outputs: {},
      enabled: true,
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

/**
 * Generates the registry corpus. Pure apart from reading the registry: the same seed and the same
 * registry give the same cases in the same order.
 */
export function generateRegistryCorpus(options: CorpusOptions = {}): CorpusCase[] {
  const seed = options.seed ?? DEFAULT_CORPUS_SEED
  const configs = options.blocks ?? Object.values(getBlockRegistry())
  const all = Object.values(getBlockRegistry())
  const byType = new Map(all.map((config) => [config.type, config]))
  for (const config of configs) byType.set(config.type, config)

  const toolCandidate =
    byType.get('slack') ??
    all.find((config) => config.tools.access.length > 0 && operationsOf(config).length > 1)
  const registry: Registry = {
    byType,
    toolType: toolCandidate
      ? { type: toolCandidate.type, operations: operationsOf(toolCandidate) }
      : null,
  }

  return [
    ...configs.flatMap((config) => blockCases(config, registry, seed)),
    ...branchCases(registry, seed),
    ...collisionCases(registry, seed),
    ...subflowCases(registry, seed),
    ...inputFormatCases(registry, seed),
    ...variableCases(registry, seed),
    ...unknownTypeCases(registry, seed),
  ]
}
