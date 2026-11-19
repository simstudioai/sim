/**
 * Random canvas edits for the editing fidelity fuzz: every operation the canvas and the JSON API
 * make, applied through the real editing engine (`applyOperationsToWorkflowState`, the engine
 * behind `POST /api/v2/workflows/{id}/operations` and Copilot's `edit_workflow`), the enablement
 * slice (`decideBlockEnablement`), and the shapes a canvas drag or a variables write stores.
 *
 * Operations are plain data generated from a seeded PRNG against the current state, so a failing
 * sequence replays exactly and shrinks by dropping operations. Test-only.
 */

import { compareStrings } from '@sim/utils/string'
import { isVisible } from '@/lib/workflows/code/corpus/blocks'
import type { SeededRandom } from '@/lib/workflows/code/corpus/random'
import {
  type FillContext,
  fillSubBlockValue,
  isWritableSubBlock,
  resolveOptions,
} from '@/lib/workflows/code/corpus/values'
import { decideBlockEnablement } from '@/lib/workflows/editing/block-enablement'
import { applyOperationsToWorkflowState } from '@/lib/workflows/editing/engine'
import type { EditWorkflowOperation } from '@/lib/workflows/editing/types'
import { prepareWorkflowStateForPersistence } from '@/lib/workflows/persistence/prepare-state'
import { validateWorkflowState } from '@/lib/workflows/sanitization/validation'
import { isTriggerModeSubBlock } from '@/lib/workflows/subblocks/visibility'
import { getBlockRegistry } from '@/blocks/registry'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import { TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/constants'

/** Every kind of canvas edit the fuzz makes, for coverage reporting. */
export const CANVAS_OP_KINDS = [
  'add-block',
  'add-container',
  'delete-block',
  'move-block',
  'edit-subblock',
  'connect',
  'disconnect',
  'insert-into-subflow',
  'extract-from-subflow',
  'rename',
  'toggle-enabled',
  'change-type',
  'trigger-mode',
  'advanced-mode',
  'edit-loop',
  'add-variable',
  'edit-variable',
  'delete-variable',
] as const

export type CanvasOpKind = (typeof CANVAS_OP_KINDS)[number]

/** One canvas edit, as replayable data. */
export type CanvasOp =
  | { kind: CanvasOpKind; via: 'engine'; operations: EditWorkflowOperation[] }
  | { kind: 'toggle-enabled'; via: 'enablement'; blockId: string; enabled: boolean }
  | { kind: 'move-block'; via: 'drag'; blockId: string; position: { x: number; y: number } }
  | {
      kind: 'add-variable' | 'edit-variable' | 'delete-variable'
      via: 'variables'
      id: string
      variable: { name: string; type: string; value: unknown } | null
    }

/** The outcome of one op: the stored state after it, and whether anything was applied. */
export interface AppliedCanvasOp {
  state: WorkflowState
  /** The engine declined every operation in the op, or the op found nothing to do. */
  declined: boolean
}

const VARIABLE_TYPES = ['string', 'number', 'boolean', 'object', 'array', 'plain'] as const

const CONTAINER_TYPES = new Set(['loop', 'parallel'])

interface CanvasRegistry {
  byType: Map<string, BlockConfig>
  /** Types a canvas user can drop: not hidden, not a container. */
  addable: BlockConfig[]
  toolType: FillContext['toolType']
}

let cachedRegistry: CanvasRegistry | null = null

function operationsOf(config: BlockConfig): string[] {
  const operation = config.subBlocks.find((s) => s.id === 'operation' && s.type === 'dropdown')
  if (!operation) return []
  return (resolveOptions(operation, {}) ?? []).map((option) => option.id)
}

/** The live registry as the fuzz reads it. */
export function canvasRegistry(): CanvasRegistry {
  if (cachedRegistry) return cachedRegistry
  const all = Object.values(getBlockRegistry()).sort((a, b) => compareStrings(a.type, b.type))
  const byType = new Map(all.map((config) => [config.type, config]))
  const toolCandidate = byType.get('slack')
  cachedRegistry = {
    byType,
    addable: all.filter((config) => !config.hideFromToolbar && !CONTAINER_TYPES.has(config.type)),
    toolType: toolCandidate
      ? { type: toolCandidate.type, operations: operationsOf(toolCandidate) }
      : null,
  }
  return cachedRegistry
}

/** Subblock values as the conditions read them. */
function valuesOf(block: BlockState): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [id, subBlock] of Object.entries(block.subBlocks ?? {})) values[id] = subBlock?.value
  return values
}

function onSurface(subBlock: SubBlockConfig, config: BlockConfig, triggerSurface: boolean) {
  if (config.category === 'triggers') return true
  return triggerSurface === isTriggerModeSubBlock(subBlock)
}

/**
 * The subblocks of `config` a user can type into on this surface under these values: writable,
 * not hidden, not a server-owned trigger runtime id, and visible.
 */
export function editableSubBlocks(
  config: BlockConfig,
  values: Record<string, unknown>,
  triggerSurface: boolean
): SubBlockConfig[] {
  const seen = new Set<string>()
  return config.subBlocks.filter((subBlock) => {
    if (seen.has(subBlock.id)) return false
    seen.add(subBlock.id)
    return (
      isWritableSubBlock(subBlock) &&
      !subBlock.hidden &&
      !TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(subBlock.id) &&
      onSurface(subBlock, config, triggerSurface) &&
      isVisible(subBlock, values)
    )
  })
}

function isDefault(subBlock: SubBlockConfig, value: unknown): boolean {
  const fallback = typeof subBlock.value === 'function' ? safeThunk(subBlock.value) : undefined
  return [subBlock.defaultValue, fallback].some(
    (candidate) => candidate !== undefined && JSON.stringify(candidate) === JSON.stringify(value)
  )
}

function safeThunk(thunk: NonNullable<SubBlockConfig['value']>): unknown {
  try {
    return thunk({})
  } catch {
    return undefined
  }
}

/**
 * Non-default inputs for a block of `config`, filled in declaration order so conditions read the
 * values already chosen (an operation picks which fields show).
 */
export function fillInputs(
  config: BlockConfig,
  rng: SeededRandom,
  triggerSurface: boolean,
  seed: Record<string, unknown> = {}
): Record<string, unknown> {
  const values: Record<string, unknown> = { ...seed }
  const ctx: FillContext = {
    rng,
    values,
    newId: () => rng.uuid(),
    toolType: canvasRegistry().toolType,
  }
  for (const subBlock of config.subBlocks) {
    if (Object.hasOwn(values, subBlock.id)) continue
    if (!editableSubBlocks(config, values, triggerSurface).includes(subBlock)) continue
    let value = fillSubBlockValue(subBlock, ctx)
    // A pick that lands on the default is no evidence the field round-trips; pick again.
    for (let retry = 0; retry < 8 && isDefault(subBlock, value); retry++) {
      value = fillSubBlockValue(subBlock, ctx)
    }
    if (value !== null && value !== undefined) values[subBlock.id] = value
  }
  return values
}

function blocksOf(state: WorkflowState): BlockState[] {
  return Object.values(state.blocks).sort((a, b) => compareStrings(a.id, b.id))
}

function isContainer(block: BlockState) {
  return CONTAINER_TYPES.has(block.type)
}

function isTriggerBlock(block: BlockState): boolean {
  const config = canvasRegistry().byType.get(block.type)
  return Boolean(block.triggerMode) || config?.category === 'triggers'
}

/** A unique display name the engine accepts. */
function freshName(state: WorkflowState, rng: SeededRandom, stem = 'Fuzz'): string {
  const taken = new Set(Object.values(state.blocks).map((b) => b.name.toLowerCase()))
  for (;;) {
    const name = `${stem} ${rng.int(1, 99_999)}`
    if (!taken.has(name.toLowerCase())) return name
  }
}

function engine(kind: CanvasOpKind, ...operations: EditWorkflowOperation[]): CanvasOp {
  return { kind, via: 'engine', operations }
}

/**
 * One random canvas edit against `state`, or `null` when the chosen kind has nothing to act on
 * (no edges to remove, no container to insert into).
 */
export function randomCanvasOp(
  state: WorkflowState,
  rng: SeededRandom,
  kind: CanvasOpKind = rng.pick(CANVAS_OP_KINDS)
): CanvasOp | null {
  const registry = canvasRegistry()
  const blocks = blocksOf(state)
  const unlocked = blocks.filter((b) => !b.locked)
  const containers = unlocked.filter(isContainer)
  const pickBlock = (candidates: BlockState[]) =>
    candidates.length > 0 ? rng.pick(candidates) : null

  switch (kind) {
    case 'add-block': {
      const config = rng.pick(registry.addable)
      const triggerSurface = config.category === 'triggers'
      const id = rng.uuid()
      const source = pickBlock(blocks.filter((b) => !b.data?.parentId))
      return engine(
        kind,
        {
          operation_type: 'add',
          block_id: id,
          params: {
            type: config.type,
            name: freshName(state, rng),
            inputs: fillInputs(config, rng, triggerSurface),
            ...(source && !triggerSurface && rng.bool() && { connections: {} }),
          },
        },
        ...(source && !triggerSurface
          ? [
              {
                operation_type: 'edit' as const,
                block_id: source.id,
                params: { connections: connectionsWith(state, source.id, id) },
              },
            ]
          : [])
      )
    }
    case 'add-container': {
      const type = rng.pick(['loop', 'parallel'] as const)
      const id = rng.uuid()
      const inputs =
        type === 'loop'
          ? rng.pick([
              { loopType: 'for', iterations: rng.int(1, 20) },
              { loopType: 'forEach', collection: '<start.input>' },
              { loopType: 'while', condition: '<start.input> < 3' },
              { loopType: 'doWhile', condition: '<start.input> < 3' },
            ])
          : rng.pick([
              { parallelType: 'count', count: rng.int(1, 20) },
              { parallelType: 'collection', collection: '[1, 2, 3]' },
            ])
      const childConfig = rng.pick(registry.addable.filter((c) => c.category !== 'triggers'))
      return engine(kind, {
        operation_type: 'add',
        block_id: id,
        params: {
          type,
          name: freshName(state, rng, type === 'loop' ? 'Loop' : 'Parallel'),
          inputs,
          nestedNodes: {
            [rng.uuid()]: {
              type: childConfig.type,
              name: freshName(state, rng, 'Child'),
              inputs: fillInputs(childConfig, rng, false),
            },
          },
        },
      })
    }
    case 'delete-block': {
      const block = pickBlock(unlocked)
      return block && engine(kind, { operation_type: 'delete', block_id: block.id })
    }
    case 'move-block': {
      const block = pickBlock(blocks)
      return (
        block && {
          kind,
          via: 'drag',
          blockId: block.id,
          position: { x: rng.int(-2000, 2000), y: rng.int(-2000, 2000) },
        }
      )
    }
    case 'edit-subblock': {
      const block = pickBlock(unlocked.filter((b) => registry.byType.has(b.type)))
      if (!block) return null
      const config = registry.byType.get(block.type)
      if (!config) return null
      const triggerSurface = Boolean(block.triggerMode) || config.category === 'triggers'
      const values = valuesOf(block)
      const editable = editableSubBlocks(config, values, triggerSurface)
      if (editable.length === 0) return null
      const subBlock = rng.pick(editable)
      const value = rng.bool()
        ? fillSubBlockValue(subBlock, {
            rng,
            values,
            newId: () => rng.uuid(),
            toolType: registry.toolType,
          })
        : rng.pick(['', `edited ${rng.int(0, 999)} <start.input>`, 42, true, null])
      return engine(kind, {
        operation_type: 'edit',
        block_id: block.id,
        params: { inputs: { [subBlock.id]: value } },
      })
    }
    case 'connect': {
      const source = pickBlock(unlocked)
      if (!source) return null
      const scope = source.data?.parentId
      const target = pickBlock(
        blocks.filter((b) => b.id !== source.id && b.data?.parentId === scope && !isTriggerBlock(b))
      )
      if (!target) return null
      return engine(kind, {
        operation_type: 'edit',
        block_id: source.id,
        params: { connections: connectionsWith(state, source.id, target.id, rng) },
      })
    }
    case 'disconnect': {
      const edges = [...state.edges].sort((a, b) => compareStrings(a.id, b.id))
      if (edges.length === 0) return null
      const edge = rng.pick(edges)
      return engine(kind, {
        operation_type: 'edit',
        block_id: edge.source,
        params: {
          removeEdges: [
            { targetBlockId: edge.target, sourceHandle: edge.sourceHandle ?? 'source' },
          ],
        },
      })
    }
    case 'insert-into-subflow': {
      const container = pickBlock(containers)
      if (!container) return null
      const moving = pickBlock(
        unlocked.filter(
          (b) => !isContainer(b) && !isTriggerBlock(b) && b.data?.parentId !== container.id
        )
      )
      if (moving && rng.bool()) {
        return engine(kind, {
          operation_type: 'insert_into_subflow',
          block_id: moving.id,
          params: { subflowId: container.id, type: moving.type, name: moving.name },
        })
      }
      const config = rng.pick(registry.addable.filter((c) => c.category !== 'triggers'))
      return engine(kind, {
        operation_type: 'insert_into_subflow',
        block_id: rng.uuid(),
        params: {
          subflowId: container.id,
          type: config.type,
          name: freshName(state, rng),
          inputs: fillInputs(config, rng, false),
        },
      })
    }
    case 'extract-from-subflow': {
      const child = pickBlock(unlocked.filter((b) => b.data?.parentId))
      if (!child?.data?.parentId) return null
      return engine(kind, {
        operation_type: 'extract_from_subflow',
        block_id: child.id,
        params: { subflowId: child.data.parentId },
      })
    }
    case 'rename': {
      const block = pickBlock(unlocked)
      return (
        block &&
        engine(kind, {
          operation_type: 'edit',
          block_id: block.id,
          params: { name: freshName(state, rng, rng.pick(['Renamed', 'Step', 'Ünïcode'])) },
        })
      )
    }
    case 'toggle-enabled': {
      const block = pickBlock(blocks)
      return (
        block && { kind, via: 'enablement', blockId: block.id, enabled: block.enabled === false }
      )
    }
    case 'change-type': {
      const block = pickBlock(unlocked.filter((b) => !isContainer(b) && !isTriggerBlock(b)))
      if (!block) return null
      const config = rng.pick(registry.addable.filter((c) => c.category !== 'triggers'))
      return engine(kind, {
        operation_type: 'edit',
        block_id: block.id,
        params: {
          type: config.type,
          ...(rng.bool() && { inputs: fillInputs(config, rng, false) }),
        },
      })
    }
    case 'trigger-mode': {
      const block = pickBlock(
        unlocked.filter((b) => {
          const config = registry.byType.get(b.type)
          return Boolean(config?.triggers?.enabled) && config?.category !== 'triggers'
        })
      )
      return (
        block &&
        engine(kind, {
          operation_type: 'edit',
          block_id: block.id,
          params: { triggerMode: !block.triggerMode },
        })
      )
    }
    case 'advanced-mode': {
      const block = pickBlock(unlocked.filter((b) => !isContainer(b)))
      return (
        block &&
        engine(kind, {
          operation_type: 'edit',
          block_id: block.id,
          params: { advancedMode: !block.advancedMode },
        })
      )
    }
    case 'edit-loop': {
      const container = pickBlock(containers)
      if (!container) return null
      const inputs =
        container.type === 'loop'
          ? rng.pick([
              { loopType: rng.pick(['for', 'forEach', 'while', 'doWhile']) },
              { iterations: rng.int(1, 50) },
              { collection: '<start.input>' },
              { condition: '<start.input> > 1' },
            ])
          : rng.pick([
              { parallelType: rng.pick(['count', 'collection']) },
              { count: rng.int(1, 50) },
              { collection: '["a", "b"]' },
            ])
      return engine(kind, {
        operation_type: 'edit',
        block_id: container.id,
        params: { inputs },
      })
    }
    case 'add-variable': {
      const taken = new Set(Object.values(state.variables ?? {}).map((v) => v.name.toLowerCase()))
      let name = `fuzzVar${rng.int(1, 9999)}`
      while (taken.has(name.toLowerCase())) name = `fuzzVar${rng.int(1, 9999)}`
      return {
        kind,
        via: 'variables',
        id: rng.uuid(),
        variable: { name, ...randomVariableValue(rng) },
      }
    }
    case 'edit-variable':
    case 'delete-variable': {
      const variables = Object.values(state.variables ?? {}).sort((a, b) =>
        compareStrings(a.id, b.id)
      )
      if (variables.length === 0) return null
      const variable = rng.pick(variables)
      return {
        kind,
        via: 'variables',
        id: variable.id,
        variable:
          kind === 'delete-variable' ? null : { name: variable.name, ...randomVariableValue(rng) },
      }
    }
  }
}

function randomVariableValue(rng: SeededRandom): { type: string; value: unknown } {
  const type = rng.pick(VARIABLE_TYPES)
  switch (type) {
    case 'number':
      return { type, value: rng.int(-100, 100) }
    case 'boolean':
      return { type, value: rng.bool() }
    case 'object':
      return { type, value: { key: `value ${rng.int(0, 9)}` } }
    case 'array':
      return { type, value: [1, 'two', { three: 3 }] }
    default:
      return { type, value: `text ${rng.int(0, 999)} <start.input>` }
  }
}

/**
 * The full outgoing connection map of `sourceId` with `targetId` added: the engine's `edit`
 * replaces a block's outgoing edges, so the existing ones are restated.
 */
function connectionsWith(
  state: WorkflowState,
  sourceId: string,
  targetId: string,
  rng?: SeededRandom
): Record<string, string[]> {
  const connections: Record<string, string[]> = {}
  for (const edge of state.edges) {
    if (edge.source !== sourceId) continue
    const handle = edge.sourceHandle ?? 'source'
    connections[handle] = [...(connections[handle] ?? []), edge.target]
  }
  const handle = rng && rng.int(0, 4) === 0 ? 'error' : 'source'
  connections[handle] = [...(connections[handle] ?? []), targetId]
  return connections
}

/**
 * The state a canvas edit stores: the engine's output validated and shaped as
 * `applyWorkflowOperations` persists it (`validateWorkflowState` with sanitize, then
 * `prepareWorkflowStateForPersistence`), with the workflow's variables beside it.
 */
export function applyCanvasOp(state: WorkflowState, op: CanvasOp): AppliedCanvasOp {
  const variables = state.variables ?? {}
  switch (op.via) {
    case 'drag': {
      const block = state.blocks[op.blockId]
      if (!block) return { state, declined: true }
      return {
        state: {
          ...state,
          blocks: { ...state.blocks, [op.blockId]: { ...block, position: op.position } },
        },
        declined: false,
      }
    }
    case 'variables': {
      const next = { ...variables }
      if (op.variable === null) {
        if (!next[op.id]) return { state, declined: true }
        delete next[op.id]
      } else {
        next[op.id] = { id: op.id, ...op.variable } as (typeof next)[string]
      }
      return { state: { ...state, variables: next }, declined: false }
    }
    case 'enablement': {
      const decision = decideBlockEnablement(state.blocks, op.blockId, op.enabled)
      if (decision.outcome !== 'changed') return { state, declined: true }
      return { state: { ...state, blocks: decision.blocks }, declined: false }
    }
    case 'engine': {
      const result = applyOperationsToWorkflowState({ ...state }, op.operations)
      const validation = validateWorkflowState(result.state, { sanitize: true })
      if (!validation.valid) return { state, declined: true }
      const edited = (validation.sanitizedState ?? result.state) as WorkflowState
      const prepared = prepareWorkflowStateForPersistence({
        blocks: edited.blocks,
        edges: edited.edges,
      }).state
      return {
        state: { ...prepared, variables },
        declined: result.declinedOperationCount === op.operations.length,
      }
    }
  }
}
