/**
 * Editing fidelity: the canvas (the editing engine's operations and the graph they store) and
 * workflow source stay in lockstep. Starting from corpus workflows, random sequences of real
 * canvas edits (`canvas-ops.test-helpers.ts`) are applied; after each sequence the stored graph is
 * read as source and the source applied back unchanged, which must change nothing (P6 and P7 over
 * edited graphs). Then one random edit is made to the source and applied, and the stored graph
 * must change by exactly that edit and nothing else.
 *
 * Every trial is a seeded PRNG stream, so a failure names its seed and, shrunk by dropping canvas
 * edits one at a time while it still fails, its minimal edit sequence.
 *
 * CI budget: `EDITING_FUZZ_ITERATIONS` (default 1,500) trials fit in about 30 s. A long local run
 * sets it higher; `EDITING_FUZZ_SEED` moves the seed and `EDITING_FUZZ_REPORT_PATH` writes the
 * stats (trials, edits by kind, block types and subblock kinds covered).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')
vi.unmock('@/tools/registry')

import { getErrorMessage } from '@sim/utils/errors'
import { compareStrings } from '@sim/utils/string'
import {
  type CanonicalBlock,
  type CanonicalWorkflow,
  executableInactiveParams,
  executableView,
  setOwn,
} from '@sim/workflow-code'
import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import { registryCatalog as catalog } from '@/lib/workflows/code/catalog/registry-catalog.test-helpers'
import { DEFAULT_CORPUS_SEED } from '@/lib/workflows/code/corpus'
import {
  applyCanvasOp,
  CANVAS_OP_KINDS,
  type CanvasOp,
  canvasRegistry,
  editableSubBlocks,
  fillInputs,
  randomCanvasOp,
} from '@/lib/workflows/code/corpus/canvas-ops.test-helpers'
import { corpusSubjects } from '@/lib/workflows/code/corpus/fixtures.test-helpers'
import { findDifferences } from '@/lib/workflows/code/corpus/proof'
import { createSeededRandom, type SeededRandom } from '@/lib/workflows/code/corpus/random'
import {
  applySource,
  type GotSource,
  getSource,
  hintsOfLock,
  printFiles,
} from '@/lib/workflows/code/corpus/source-harness.test-helpers'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import type { EditWorkflowOperation } from '@/lib/workflows/editing/types'
import type { BlockConfig } from '@/blocks/types'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

const ITERATIONS = Number(process.env.EDITING_FUZZ_ITERATIONS ?? 1_500)
const BASE_SEED = Number(process.env.EDITING_FUZZ_SEED ?? DEFAULT_CORPUS_SEED)
const REPORT_PATH = process.env.EDITING_FUZZ_REPORT_PATH
const MAX_EDITS_PER_TRIAL = 6
/** The fuzz stops collecting after this many failures; each one is already shrunk. */
const MAX_REPORTED_FAILURES = 10
/** About 12 ms per trial on a laptop, so the default fits the 60 s CI budget with room to spare. */
const FUZZ_BUDGET_MS = Math.max(120_000, ITERATIONS * 60)

const subjects = corpusSubjects().filter((subject) => !subject.unknownTypes)
const hooks = createMaterializeHooks()

const stats = {
  trials: 0,
  canvasEdits: {} as Record<string, { applied: number; declined: number }>,
  codeEdits: {} as Record<string, number>,
  blockTypes: { registry: 0, covered: 0, editedOnly: [] as string[], notCovered: [] as string[] },
  subBlockKinds: { declared: 0, covered: 0, uncovered: [] as string[] },
}

const EMPTY: WorkflowState = { blocks: {}, edges: [], loops: {}, parallels: {}, variables: {} }

function replay(start: WorkflowState, ops: CanvasOp[]): WorkflowState {
  let state = start
  for (const op of ops) state = applyCanvasOp(state, op).state
  return state
}

function engineOp(...operations: EditWorkflowOperation[]): CanvasOp {
  return { kind: 'connect', via: 'engine', operations }
}

function attempt(run: () => string | null): string | null {
  try {
    return run()
  } catch (error) {
    return `threw: ${getErrorMessage(error, String(error))}`
  }
}

function compileErrors(applied: ReturnType<typeof applySource>): string {
  return applied.compiled.diagnostics
    .filter((d) => d.severity === 'error')
    .map((d) => `${d.code} ${d.message}`)
    .join('; ')
}

/** Why `source get` → `source apply` of the unchanged files is not a no-op, or `null`. */
function noopFailure(state: WorkflowState): string | null {
  const got = getSource(state, catalog)
  const applied = applySource(state, got, got.files, catalog)
  if (!applied.materialized) return `compile: ${compileErrors(applied)}`
  const differences = findDifferences(state, applied.materialized.state, 5)
  if (differences.length > 0) return `state: ${JSON.stringify(differences)}`
  if (!applied.noop) return 'diff: an unchanged source diffs as a change'
  return null
}

/** One source-level edit: the model it writes, and the stored paths it may and must change. */
interface CodeEdit {
  kind:
    | 'set-param'
    | 'toggle-enabled'
    | 'rename'
    | 'delete-block'
    | 'remove-edge'
    | 'edit-variable'
    | 'add-block'
  target: CanonicalWorkflow
  /** Whether a path (RFC 6901, into the stored state) is one the edit may change. */
  allowed: (path: string) => boolean
  /** Path prefixes the edit must change. */
  required: string[]
  /** Config keys may change value but never appear or disappear. */
  rewritesOnly?: boolean
  /** For a rename, the key the edited block moves from and to. */
  renamed?: { from: string; to: string }
}

const CODE_EDIT_KINDS: ReadonlyArray<CodeEdit['kind']> = [
  'set-param',
  'toggle-enabled',
  'rename',
  'delete-block',
  'remove-edge',
  'edit-variable',
  'add-block',
]

/** Stored subblock values (`<old.x>` → `<new.x>` after a rename). */
const SUBBLOCK_VALUE = /^\/blocks\/[^/]+\/subBlocks\/[^/]+\/value(\/|$)/
/** A pair's stored mode. */
const CANONICAL_MODE = /^\/blocks\/[^/]+\/data\/canonicalModes(\/|$)/
/** A loop or parallel config, in `block.data` and the subflow maps. */
const SUBFLOW_CONFIG =
  /^\/(blocks\/[^/]+\/data\/(count|collection|whileCondition|doWhileCondition|batchSize)|loops\/[^/]+\/[^/]+|parallels\/[^/]+\/[^/]+)$/
/** Container membership in the subflow maps. */
const SUBFLOW_NODES = /^\/(loops|parallels)\/[^/]+\/nodes(\/|$)/
/** A whole block appearing or disappearing. */
const WHOLE_BLOCK = /^\/blocks\/[^/]+$/

function idOf(got: GotSource, key: string): string {
  const entry = got.lock.blocks[key]
  if (!entry) throw new Error(`no lock entry for ${key}`)
  return entry.id
}

/**
 * Active free-text params of a block that no other field's visibility or options read, so a new
 * value changes that one field and nothing it gates.
 */
function freeTextParams(block: CanonicalBlock): string[] {
  const config = canvasRegistry().byType.get(block.type)
  if (!config) return []
  const inactive = new Set(executableInactiveParams(block, catalog))
  const gates = new Set<string>()
  for (const subBlock of config.subBlocks) {
    const condition = subBlock.condition
    if (condition && typeof condition === 'object' && typeof condition.field === 'string') {
      gates.add(condition.field)
      if (condition.and && typeof condition.and.field === 'string') gates.add(condition.and.field)
    }
    const dependsOn = subBlock.dependsOn
    for (const dependency of Array.isArray(dependsOn) ? dependsOn : (dependsOn?.all ?? [])) {
      gates.add(dependency)
    }
  }
  return Object.entries(block.params)
    .filter(([id, param]) => {
      if (param.kind !== 'value' || typeof param.value !== 'string') return false
      if (inactive.has(id) || gates.has(id)) return false
      return config.subBlocks.some(
        (s) =>
          s.id === id &&
          !s.password &&
          !s.hidden &&
          !s.canonicalParamId &&
          (s.type === 'short-input' || s.type === 'long-input')
      )
    })
    .map(([id]) => id)
    .sort(compareStrings)
}

/** Every string inside `value` with `rewrite` applied. */
function mapStrings(value: unknown, rewrite: (text: string) => string): unknown {
  if (typeof value === 'string') return rewrite(value)
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, rewrite))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, member]) => [key, mapStrings(member, rewrite)])
  ) as unknown
}

/**
 * Renames block `from` to `to` as an author would: its key and display name, the children and
 * edges that name it, and every reference to it (`<from.x>` → `<to.x>`), which is what the
 * printed file's interpolations compile to once the name changes.
 */
function rekey(workflow: CanonicalWorkflow, from: string, to: string, name: string): void {
  const rewrite = (text: string) => text.split(`<${from}.`).join(`<${to}.`)
  const blocks: CanonicalWorkflow['blocks'] = {}
  for (const [key, block] of Object.entries(workflow.blocks)) {
    const next: CanonicalBlock = {
      ...block,
      params: mapStrings(block.params, rewrite) as CanonicalBlock['params'],
      ...(block.branches && {
        branches: mapStrings(block.branches, rewrite) as CanonicalBlock['branches'],
      }),
      ...(block.subflow && {
        subflow: mapStrings(block.subflow, rewrite) as CanonicalBlock['subflow'],
      }),
      ...(key === from && { key: to, name }),
      ...(block.parent === from && { parent: to }),
    }
    setOwn(blocks, key === from ? to : key, next)
  }
  workflow.blocks = blocks
  workflow.edges = workflow.edges.map((edge) => ({
    ...edge,
    from: edge.from === from ? to : edge.from,
    to: edge.to === from ? to : edge.to,
  }))
}

/**
 * Renames block `from` in the source. Every stored reference to it is rewritten, and a pair whose
 * value held one is written through the member that takes text: whether a selector or typed text
 * produced a value is canvas state source keeps only for a plain id (DESIGN.md "Preserved state").
 */
function renameEdit(got: GotSource, from: string, name: string): CodeEdit {
  const target: CanonicalWorkflow = structuredClone(got.lockless.workflow)
  const to = normalizeWorkflowBlockName(name)
  rekey(target, from, to, name)
  const at = `/blocks/${idOf(got, from)}/name`
  return {
    kind: 'rename',
    target,
    allowed: (p) =>
      p === at || SUBBLOCK_VALUE.test(p) || CANONICAL_MODE.test(p) || SUBFLOW_CONFIG.test(p),
    // A config value the rename rewrites changes in place; storage gains no other config key.
    rewritesOnly: true,
    required: [at],
    renamed: { from, to },
  }
}

/**
 * Deleting an `onError` line (or the block it wires) leaves a block's error port only where its
 * own stored flag sets it, as the file then compiles.
 */
function settleErrorPorts(state: WorkflowState, got: GotSource, target: CanonicalWorkflow): void {
  for (const [key, block] of Object.entries(target.blocks)) {
    if (!block.errorPort) continue
    const wired = target.edges.some((edge) => edge.from === key && edge.port.kind === 'error')
    const entry = got.lock.blocks[key]
    const flagged = entry ? state.blocks[entry.id]?.errorEnabled === true : false
    block.errorPort = wired || flagged
  }
}

/** One random edit of the model `got` printed, as an author would write it in the file. */
function randomCodeEdit(
  state: WorkflowState,
  got: GotSource,
  rng: SeededRandom,
  n: number
): CodeEdit | null {
  const base = got.lockless.workflow
  const target: CanonicalWorkflow = structuredClone(base)
  const keys = Object.keys(base.blocks).sort(compareStrings)
  const editable = keys.filter((key) => {
    const block = base.blocks[key]
    const parent = block.parent ? base.blocks[block.parent] : undefined
    return !block.subflow && !block.locked && !parent?.locked
  })
  // By design (DESIGN.md "Identity"): a legacy collision key (`name~2`) compiles only while its
  // base key is taken, so source never introduces one. Deleting or renaming the block holding the
  // base leaves the other's `meta.key` naming nothing (E_KEY_OVERRIDE) until the author drops it.
  const collisionBases = new Set(
    keys.flatMap((key) => (key.includes('~') ? [key.split('~')[0]] : []))
  )
  const removable = editable.filter((key) => !collisionBases.has(key))
  const kind = rng.pick(CODE_EDIT_KINDS)
  switch (kind) {
    case 'set-param': {
      const candidates = editable.flatMap((key) =>
        freeTextParams(base.blocks[key]).map((param) => [key, param] as const)
      )
      if (candidates.length === 0) return null
      const [key, param] = rng.pick(candidates)
      target.blocks[key].params[param] = { kind: 'value', value: `fidelity edit ${n}` }
      const id = idOf(got, key)
      const at = `/blocks/${id}/subBlocks/${param}/value`
      return {
        kind,
        target,
        allowed: (p) => p === at || p.startsWith(`/blocks/${id}/outputs`),
        required: [at],
      }
    }
    case 'toggle-enabled': {
      if (editable.length === 0) return null
      const key = rng.pick(editable)
      target.blocks[key].enabled = !base.blocks[key].enabled
      const at = `/blocks/${idOf(got, key)}/enabled`
      return { kind, target, allowed: (p) => p === at, required: [at] }
    }
    case 'rename': {
      if (removable.length === 0) return null
      return renameEdit(got, rng.pick(removable), `Renamed In Code ${n}`)
    }
    case 'delete-block': {
      const leaves = removable.filter((key) => !keys.some((k) => base.blocks[k].parent === key))
      if (leaves.length === 0) return null
      const key = rng.pick(leaves)
      delete target.blocks[key]
      target.edges = target.edges.filter((edge) => edge.from !== key && edge.to !== key)
      settleErrorPorts(state, got, target)
      const at = `/blocks/${idOf(got, key)}`
      return {
        kind,
        target,
        allowed: (p) => p === at || p.startsWith('/edges') || SUBFLOW_NODES.test(p),
        required: [at],
      }
    }
    case 'remove-edge': {
      if (base.edges.length === 0) return null
      const index = rng.int(0, base.edges.length - 1)
      target.edges = base.edges.filter((_, i) => i !== index)
      settleErrorPorts(state, got, target)
      return { kind, target, allowed: (p) => p.startsWith('/edges'), required: ['/edges'] }
    }
    case 'edit-variable': {
      const varKeys = Object.keys(base.variables).sort(compareStrings)
      if (varKeys.length === 0) return null
      const key = rng.pick(varKeys)
      target.variables[key] = { ...target.variables[key], type: 'plain', value: `fidelity ${n}` }
      const at = `/variables/${got.lock.variables[key]}`
      return { kind, target, allowed: (p) => p.startsWith(at), required: [`${at}/value`] }
    }
    case 'add-block': {
      const key = `fidelityadded${n}`
      target.blocks[key] = {
        key,
        name: `Fidelity Added ${n}`,
        type: 'function',
        parent: null,
        enabled: true,
        locked: false,
        triggerMode: false,
        advancedMode: false,
        errorPort: false,
        retry: null,
        params: { code: { kind: 'value', value: `return ${n}` } },
        modes: {},
      }
      return { kind, target, allowed: (p) => WHOLE_BLOCK.test(p), required: [] }
    }
  }
}

/** Why applying `edit` through source did not change the stored graph by exactly that edit. */
function codeEditFailure(state: WorkflowState, got: GotSource, edit: CodeEdit): string | null {
  const hints = hintsOfLock(got.lock)
  const renamedHint =
    edit.renamed && Object.hasOwn(hints.blocks, edit.renamed.from)
      ? hints.blocks[edit.renamed.from]
      : undefined
  if (edit.renamed && renamedHint) setOwn(hints.blocks, edit.renamed.to, renamedHint)
  const files = printFiles(edit.target, catalog, hints)
  const applied = applySource(state, got, files, catalog)
  if (!applied.materialized) return `compile: ${compileErrors(applied)}`
  const written = applied.materialized
  // What runs is exactly the edit: the written model's executable view is the edited model's.
  // (Materialize restores preserved state onto the compiled model, so only the views compare.)
  const added =
    edit.kind === 'add-block'
      ? Object.keys(edit.target.blocks).find((k) => !got.lock.blocks[k])
      : undefined
  const view = (workflow: CanonicalWorkflow) => {
    const projected = executableView(workflow, catalog)
    // A block added with no params runs with its type's defaults (DESIGN.md "Defaults").
    if (added) delete projected.blocks[added]
    return projected
  }
  const misread = findDifferences(view(edit.target), view(written.workflow), 5)
  if (misread.length > 0) return `runs differently than the edit: ${JSON.stringify(misread)}`
  const differences = findDifferences(state, written.state, 500)
  const stray = differences.filter(
    (d) =>
      !edit.allowed(d.path) ||
      (edit.rewritesOnly === true && SUBFLOW_CONFIG.test(d.path) && d.kind !== 'value')
  )
  if (stray.length > 0) return `changed beyond the edit: ${JSON.stringify(stray.slice(0, 5))}`
  const missing = edit.required.filter((at) => !differences.some((d) => d.path.startsWith(at)))
  if (missing.length > 0) return `edit not stored: ${missing.join(', ')}`
  const grew = Object.keys(written.state.blocks).length - Object.keys(state.blocks).length
  if (edit.kind === 'add-block' && grew !== 1) return `add-block stored ${grew} new blocks`
  return null
}

interface Trial {
  seed: number
  subjectId: string
  start: WorkflowState
  ops: CanvasOp[]
}

function generateTrial(seed: number): { trial: Trial; state: WorkflowState; rng: SeededRandom } {
  const rng = createSeededRandom(seed)
  const subject = rng.pick(subjects)
  let state = subject.state
  const ops: CanvasOp[] = []
  const length = rng.int(1, MAX_EDITS_PER_TRIAL)
  for (let n = 0; n < length; n++) {
    const op = randomCanvasOp(state, rng)
    if (!op) continue
    const result = applyCanvasOp(state, op)
    stats.canvasEdits[op.kind] ??= { applied: 0, declined: 0 }
    stats.canvasEdits[op.kind][result.declined ? 'declined' : 'applied'] += 1
    ops.push(op)
    state = result.state
  }
  return { trial: { seed, subjectId: subject.id, start: subject.state, ops }, state, rng }
}

/**
 * The op list left after dropping ops one at a time while `fails` still holds: one-minimal, so
 * removing any single remaining op makes the failure go away.
 */
function shrink(start: WorkflowState, ops: CanvasOp[], fails: (state: WorkflowState) => boolean) {
  let current = ops
  for (let changed = true; changed; ) {
    changed = false
    for (let i = 0; i < current.length && !changed; i++) {
      const candidate = current.filter((_, j) => j !== i)
      if (attempt(() => (fails(replay(start, candidate)) ? 'fails' : null)) !== null) {
        current = candidate
        changed = true
      }
    }
  }
  return current
}

function describeFailure(trial: Trial, minimal: CanvasOp[], failure: string): string {
  return `seed ${trial.seed} (${trial.subjectId}): ${failure}\n  minimal canvas edits: ${JSON.stringify(minimal)}`
}

describe(`editing fidelity fuzz (${ITERATIONS} trials from seed ${BASE_SEED})`, () => {
  it(
    'applies the source of every edited workflow back unchanged, and one source edit exactly',
    () => {
      const failures: string[] = []
      for (let i = 0; i < ITERATIONS && failures.length < MAX_REPORTED_FAILURES; i++) {
        const { trial, state, rng } = generateTrial(BASE_SEED + i)
        stats.trials += 1
        const noop = attempt(() => noopFailure(state))
        if (noop) {
          const minimal = shrink(trial.start, trial.ops, (s) => noopFailure(s) !== null)
          failures.push(describeFailure(trial, minimal, noop))
          continue
        }
        const got = getSource(state, catalog)
        const edit = randomCodeEdit(state, got, rng, i)
        if (!edit) continue
        stats.codeEdits[edit.kind] = (stats.codeEdits[edit.kind] ?? 0) + 1
        const failure = attempt(() => codeEditFailure(state, got, edit))
        if (failure) failures.push(describeFailure(trial, trial.ops, `${edit.kind}: ${failure}`))
      }
      expect(failures).toEqual([])
      // A run long enough to draw every kind applies each at least once.
      if (ITERATIONS >= 500) {
        const unexercised = CANVAS_OP_KINDS.filter((kind) => !stats.canvasEdits[kind]?.applied)
        expect(unexercised).toEqual([])
      }
    },
    FUZZ_BUDGET_MS
  )
})

function operationsOf(config: BlockConfig): Array<string | undefined> {
  const operation = config.subBlocks.find((s) => s.id === 'operation' && s.type === 'dropdown')
  const options = operation && Array.isArray(operation.options) ? operation.options : []
  const ids = options.flatMap((option) => (typeof option.id === 'string' ? [option.id] : []))
  return ids.length > 0 ? ids : [undefined]
}

/** The subblock kinds a stored block holds a value in that differs from a fresh block's. */
function coveredKinds(config: BlockConfig, stored: BlockState, triggerSurface: boolean) {
  const fresh = hooks.initBlock({
    id: stored.id,
    type: config.type,
    name: stored.name,
    triggerMode: stored.triggerMode === true,
  }).subBlocks
  const values: Record<string, unknown> = {}
  for (const [id, subBlock] of Object.entries(stored.subBlocks)) values[id] = subBlock?.value
  const covered = new Set<string>()
  for (const subBlock of editableSubBlocks(config, values, triggerSurface)) {
    const value = values[subBlock.id]
    if (value === null || value === undefined || value === '') continue
    if (JSON.stringify(value) === JSON.stringify(fresh[subBlock.id]?.value)) continue
    covered.add(subBlock.type)
  }
  return covered
}

describe('every registry block type through the editing engine', () => {
  it('adds each type with non-default values in every subblock kind it has, and applies its source back unchanged', () => {
    const startId = '00000000-0000-4000-8000-00000000000a'
    const base = replay(EMPTY, [
      engineOp({
        operation_type: 'add',
        block_id: startId,
        params: { type: 'start_trigger', name: 'Start' },
      }),
    ])
    const configs = [...canvasRegistry().byType.values()]
    stats.blockTypes.registry = configs.length
    const failures: string[] = []
    for (const config of configs) {
      const rng = createSeededRandom(BASE_SEED)
      const surfaces =
        config.category === 'triggers' ? [true] : config.triggers?.enabled ? [false, true] : [false]
      const declared = new Set<string>()
      const covered = new Set<string>()
      let added = 0
      for (const triggerMode of surfaces) {
        const triggerSurface = triggerMode || config.category === 'triggers'
        for (const operation of operationsOf(config)) {
          const seed = operation === undefined ? {} : { operation }
          const inputs = fillInputs(config, rng, triggerSurface, seed)
          const kinds = editableSubBlocks(config, inputs, triggerSurface).map((s) => s.type)
          for (const kind of kinds) declared.add(kind)
          if (added > 0 && kinds.every((kind) => covered.has(kind))) continue
          const id = rng.uuid()
          const name = `Subject ${added + 1}`
          let state = replay(base, [
            engineOp({
              operation_type: 'add',
              block_id: id,
              params: {
                type: config.type,
                name,
                ...(triggerMode && config.category !== 'triggers' && { triggerMode: true }),
                inputs,
              },
            }),
          ])
          if (!state.blocks[id]) {
            // The engine adds no legacy type and no second single-instance block, but workflows
            // already store them and the engine still edits them: store the block as canvas
            // creation made it, then edit every field through the engine.
            const created = hooks.initBlock({ id, type: config.type, name, triggerMode })
            state = replay({ ...base, blocks: { ...base.blocks, [id]: created } }, [
              engineOp({ operation_type: 'edit', block_id: id, params: { inputs } }),
            ])
            stats.blockTypes.editedOnly.push(config.type)
          }
          const stored = state.blocks[id]
          if (!stored) continue
          added += 1
          for (const kind of coveredKinds(config, stored, triggerSurface)) covered.add(kind)
          const failure = attempt(() => noopFailure(state))
          if (failure) failures.push(`${config.type} (${operation ?? 'default'}): ${failure}`)
        }
      }
      if (added === 0) {
        stats.blockTypes.notCovered.push(config.type)
        continue
      }
      stats.blockTypes.covered += 1
      stats.subBlockKinds.declared += declared.size
      for (const kind of declared) {
        if (covered.has(kind)) stats.subBlockKinds.covered += 1
        else stats.subBlockKinds.uncovered.push(`${config.type}:${kind}`)
      }
    }
    expect(failures).toEqual([])
    expect(stats.blockTypes.covered).toBeGreaterThan(0)
  }, 300_000)

  it('writes the coverage report when a report path is set', () => {
    if (!REPORT_PATH) return
    mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
    writeFileSync(REPORT_PATH, `${JSON.stringify(stats, null, 2)}\n`)
  })
})

const START = '00000000-0000-4000-8000-000000000001'
const LOOP = '00000000-0000-4000-8000-000000000002'
const CHILD = '00000000-0000-4000-8000-000000000003'
const AFTER = '00000000-0000-4000-8000-000000000004'

/** Start → a `for` loop holding one function, whose end port wires a function after it. */
const LOOP_WITH_CHILD: CanvasOp[] = [
  engineOp(
    { operation_type: 'add', block_id: START, params: { type: 'start_trigger', name: 'Start' } },
    {
      operation_type: 'add',
      block_id: LOOP,
      params: { type: 'loop', name: 'Repeat', inputs: { loopType: 'for', iterations: 3 } },
    },
    {
      operation_type: 'insert_into_subflow',
      block_id: CHILD,
      params: { subflowId: LOOP, type: 'function', name: 'Child', inputs: { code: 'return 1' } },
    },
    {
      operation_type: 'add',
      block_id: AFTER,
      params: { type: 'function', name: 'After', inputs: { code: 'return 2' } },
    }
  ),
  engineOp(
    { operation_type: 'edit', block_id: START, params: { connections: { source: LOOP } } },
    {
      operation_type: 'edit',
      block_id: LOOP,
      params: { connections: { 'loop-start-source': CHILD, 'loop-end-source': AFTER } },
    }
  ),
]

describe('editing fidelity regressions', () => {
  it('the loop fixture holds the edges each regression starts from', () => {
    const state = replay(EMPTY, LOOP_WITH_CHILD)
    expect(state.blocks[CHILD]?.data?.parentId).toBe(LOOP)
    const edges = state.edges.map((e) => `${e.source}:${e.sourceHandle}:${e.target}`)
    expect(edges.sort(compareStrings)).toEqual(
      [
        `${LOOP}:loop-end-source:${AFTER}`,
        `${LOOP}:loop-start-source:${CHILD}`,
        `${START}:source:${LOOP}`,
      ].sort(compareStrings)
    )
    expect(noopFailure(state)).toBeNull()
  })

  it.each<[string, CanvasOp[], string?]>([
    [
      'an error edge from a trigger',
      [
        ...LOOP_WITH_CHILD,
        engineOp({
          operation_type: 'edit',
          block_id: START,
          params: { connections: { source: LOOP, error: AFTER } },
        }),
      ],
    ],
    [
      'an error edge from a container',
      [
        ...LOOP_WITH_CHILD,
        engineOp({
          operation_type: 'edit',
          block_id: LOOP,
          params: {
            connections: { 'loop-start-source': CHILD, 'loop-end-source': AFTER, error: AFTER },
          },
        }),
      ],
    ],
    [
      'a block extracted from the loop its start edge wires',
      [
        ...LOOP_WITH_CHILD,
        engineOp({
          operation_type: 'extract_from_subflow',
          block_id: CHILD,
          params: { subflowId: LOOP },
        }),
      ],
      // The engine keeps the start edge, as it always has: the executor runs it as the loop's exit.
      `${LOOP}:loop-start-source:${CHILD}`,
    ],
    [
      'a block moved into the loop its end edge wires',
      [
        ...LOOP_WITH_CHILD,
        engineOp({
          operation_type: 'insert_into_subflow',
          block_id: AFTER,
          params: { subflowId: LOOP, type: 'function', name: 'After' },
        }),
      ],
      `${LOOP}:loop-end-source:${AFTER}`,
    ],
  ])('%s applies back unchanged', (_name, ops, keptEdge) => {
    const state = replay(EMPTY, ops)
    if (keptEdge) {
      const edges = state.edges.map((e) => `${e.source}:${e.sourceHandle}:${e.target}`)
      expect(edges).toContain(keptEdge)
    }
    expect(noopFailure(state)).toBeNull()
  })

  it('a sheet whose basic pair member is empty keeps its advanced member in trigger mode', () => {
    const template = subjects.find((s) => s.id.startsWith('landing-template:resume-parser-'))
    const sheet = Object.values(template?.state.blocks ?? {}).find(
      (b) => b.type === 'google_sheets_v2'
    )
    expect(sheet?.subBlocks.manualSpreadsheetId?.value).toBe('Candidates')
    if (!template || !sheet) return
    const edited = replay(template.state, [
      engineOp({ operation_type: 'edit', block_id: sheet.id, params: { triggerMode: true } }),
    ])
    expect(edited.blocks[sheet.id].triggerMode).toBe(true)
    expect(noopFailure(edited)).toBeNull()
  })
})

const PARSER = '00000000-0000-4000-8000-000000000005'
const FIRST = '00000000-0000-4000-8000-000000000006'
const SECOND = '00000000-0000-4000-8000-000000000007'

describe('an error edge a container already stores', () => {
  it('survives an engine edit that re-sends the container connections, and applies back unchanged', () => {
    const base = replay(EMPTY, LOOP_WITH_CHILD)
    // Stored before the engine refused new error edges from containers.
    const stored: WorkflowState = {
      ...base,
      edges: [
        ...base.edges,
        {
          id: '00000000-0000-4000-8000-0000000000e1',
          source: LOOP,
          target: AFTER,
          sourceHandle: 'error',
          targetHandle: 'target',
          type: 'default',
        },
      ],
    }
    const edited = replay(stored, [
      engineOp({
        operation_type: 'edit',
        block_id: LOOP,
        params: {
          connections: { 'loop-start-source': CHILD, 'loop-end-source': AFTER, error: AFTER },
        },
      }),
    ])
    const edges = edited.edges.map((e) => `${e.source}:${e.sourceHandle}:${e.target}`)
    expect(edges).toContain(`${LOOP}:error:${AFTER}`)
    expect(noopFailure(edited)).toBeNull()
  })
})

describe('the editing engine keeps values of fields that only share a table field id', () => {
  it('a JSON code field named params keeps its text and applies back unchanged', () => {
    const text = '{\n  "limit": 5\n}'
    const state = replay(EMPTY, [
      engineOp({
        operation_type: 'add',
        block_id: PARSER,
        params: { type: 'supabase_v2', name: 'Rpc', inputs: { operation: 'rpc', params: text } },
      }),
    ])
    expect(state.blocks[PARSER]?.subBlocks.params?.value).toBe(text)
    expect(noopFailure(state)).toBeNull()
  })
})

describe('a pair edited in source keeps the member its mode does not select', () => {
  it('a sheet poller in trigger mode keeps its picked sheet when the typed id changes', () => {
    const state = replay(EMPTY, [
      engineOp({
        operation_type: 'add',
        block_id: PARSER,
        params: {
          type: 'google_sheets_v2',
          name: 'Sheet',
          triggerMode: true,
          inputs: { spreadsheetId: 'picked-sheet', manualSpreadsheetId: 'typed-sheet' },
        },
      }),
    ])
    const got = getSource(state, catalog)
    const sheet = got.lockless.workflow.blocks.sheet
    expect(sheet?.modes.spreadsheetId).toBe('advanced')
    expect(sheet?.params.spreadsheetId).toEqual({ kind: 'value', value: 'picked-sheet' })
    const target: CanonicalWorkflow = structuredClone(got.lockless.workflow)
    target.blocks.sheet.params.manualSpreadsheetId = { kind: 'value', value: 'retyped-sheet' }
    const at = `/blocks/${PARSER}/subBlocks/manualSpreadsheetId/value`
    const edit: CodeEdit = {
      kind: 'set-param',
      target,
      allowed: (p) => p === at || p.startsWith(`/blocks/${PARSER}/outputs`),
      required: [at],
    }
    expect(codeEditFailure(state, got, edit)).toBeNull()
  })
})

describe('an advanced field whose empty value is an option', () => {
  it('keeps the empty choice through an unchanged apply instead of taking the default', () => {
    const state = replay(EMPTY, [
      engineOp({
        operation_type: 'add',
        block_id: PARSER,
        params: {
          type: 'cloudflare_v2',
          name: 'Certificates',
          inputs: { operation: 'list_certificates', zoneId: 'zone', certificateStatus: '' },
        },
      }),
    ])
    expect(state.blocks[PARSER]?.subBlocks.certificateStatus?.value).toBe('')
    expect(noopFailure(state)).toBeNull()
  })
})

describe('an advanced JSON field that runs under an operation that hides it', () => {
  it('keeps its stored text through an unchanged apply', () => {
    const text = JSON.stringify(
      { input: '<start.input>', quoted: "'<start.name>'", key: '{{API_KEY}}', text: 'a\nb' },
      null,
      2
    )
    const state = replay(EMPTY, [
      engineOp({
        operation_type: 'add',
        block_id: START,
        params: { type: 'start_trigger', name: 'Start' },
      }),
      engineOp({
        operation_type: 'add',
        block_id: PARSER,
        params: {
          type: 'crunchbase_v2',
          name: 'Cards',
          inputs: { operation: 'get_entity_card', cardFieldIds: text },
        },
      }),
      engineOp({
        operation_type: 'edit',
        block_id: PARSER,
        params: { inputs: { operation: 'search_people' } },
      }),
    ])
    expect(state.blocks[PARSER]?.subBlocks.cardFieldIds?.value).toBe(text)
    expect(noopFailure(state)).toBeNull()
  })
})

describe('renaming a block in source keeps the stored block it continues', () => {
  it.each<[string, () => WorkflowState, string]>([
    [
      'a block whose secret prints as stored()',
      () =>
        replay(EMPTY, [
          engineOp(
            {
              operation_type: 'add',
              block_id: START,
              params: { type: 'start_trigger', name: 'Start' },
            },
            {
              operation_type: 'add',
              block_id: PARSER,
              params: {
                type: 'serper',
                name: 'Search',
                inputs: { query: 'news', apiKey: ['literal', 'secret', 'value'].join('-') },
              },
            }
          ),
        ]),
      'search',
    ],
    [
      'a block on a cycle the canvas stored',
      () =>
        replay(EMPTY, [
          engineOp(
            {
              operation_type: 'add',
              block_id: FIRST,
              params: { type: 'function', name: 'First', inputs: { code: 'return 1' } },
            },
            {
              operation_type: 'add',
              block_id: SECOND,
              params: { type: 'function', name: 'Second', inputs: { code: 'return 2' } },
            }
          ),
          engineOp(
            {
              operation_type: 'edit',
              block_id: FIRST,
              params: { connections: { source: SECOND } },
            },
            { operation_type: 'edit', block_id: SECOND, params: { connections: { source: FIRST } } }
          ),
        ]),
      'first',
    ],
    [
      'the block a loop condition reads, writing only that condition',
      () =>
        replay(EMPTY, [
          engineOp(
            {
              operation_type: 'add',
              block_id: START,
              params: { type: 'start_trigger', name: 'Start' },
            },
            {
              operation_type: 'add',
              block_id: LOOP,
              params: {
                type: 'loop',
                name: 'Repeat',
                inputs: { loopType: 'while', condition: '<start.input> < 3' },
              },
            }
          ),
        ]),
      'start',
    ],
    [
      'a note named __proto__',
      () => {
        const subject = subjects.find((s) => s.id === 'fuzz:12')
        if (!subject) throw new Error('the fuzz:12 corpus subject is gone')
        return subject.state
      },
      '__proto__',
    ],
    [
      'a note stored before notes had a color',
      () => {
        const subject = subjects.find((s) => s.id === 'fuzz:18')
        if (!subject) throw new Error('the fuzz:18 corpus subject is gone')
        return subject.state
      },
      'x3',
    ],
  ])('%s', (_name, build, key) => {
    const state = build()
    const got = getSource(state, catalog)
    expect(Object.keys(got.lockless.workflow.blocks)).toContain(key)
    expect(codeEditFailure(state, got, renameEdit(got, key, 'Renamed In Source'))).toBeNull()
  })
})
