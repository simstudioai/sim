/**
 * The round-trip oracles, as pure functions over values the caller produces. Each
 * returns its verdict instead of throwing, so a corpus run reports every failing case rather than
 * stopping at the first. Server-side collaborators (the serializer, change detection) are
 * injected, so each oracle is a pure comparison.
 *
 * The CWM carries no encodings, so no oracle compares one: O1 compares raw
 * stored states, O2 compares what execution sees, and O3 compares CWMs through the caller's
 * equality.
 */

import { isRecordLike } from '@sim/utils/object'
import { compareStrings, escapeRegExp } from '@sim/utils/string'
import { parseJsonContainer, setOwn } from '@sim/workflow-code'
import { normalizeWorkflowBlockName, type WorkflowState } from '@sim/workflow-types/workflow'
import {
  type Difference,
  findDifferences,
  firstTextDifference,
} from '@/lib/workflows/code/corpus/proof/diff'
import type { ProofProperty } from '@/lib/workflows/code/corpus/proof/report'

/** One property's or oracle's verdict (DESIGN.md "Proof"): a pass, or the differences found. */
export type OracleResult =
  | { ok: true; oracle: ProofProperty }
  | { ok: false; oracle: ProofProperty; differences: Difference[] }

function verdict(oracle: ProofProperty, differences: Difference[]): OracleResult {
  return differences.length === 0 ? { ok: true, oracle } : { ok: false, oracle, differences }
}

/**
 * O1, no-op identity: `materialize(canonicalize(x), lock, { prev: x })` deep-equals `x` exactly.
 * This is also the "no spurious write" guarantee, so nothing is normalized away first.
 */
export function assertNoopIdentity(input: {
  original: WorkflowState
  materialized: WorkflowState
  /** `P6` when the candidate was compiled from the lean print. Default `O1`. */
  oracle?: 'O1' | 'P6'
}): OracleResult {
  return verdict(input.oracle ?? 'O1', findDifferences(input.original, input.materialized))
}

/**
 * Fixed-point check shared by O3 (`canonicalize(materialize(c))` equals `c`) and P3
 * (`print(compile(print(x))) === print(x)`): `step(value)` must equal `value`. Strings compare
 * byte for byte and report the first differing line. Other values compare with `equals` when
 * given (for CWMs, `canonicalEquals`), else exactly.
 */
export function idempotence<T>(input: {
  oracle: 'P0' | 'P1' | 'P3' | 'P5' | 'O3'
  value: T
  step: (value: T) => T
  equals?: (expected: T, actual: T) => boolean
}): OracleResult {
  const { oracle, value, step, equals } = input
  const stepped = step(value)

  if (typeof value === 'string' && typeof stepped === 'string') {
    const difference = firstTextDifference(value, stepped)
    return verdict(oracle, difference ? [difference] : [])
  }

  if (equals) {
    if (equals(value, stepped)) return { ok: true, oracle }
    const differences = findDifferences(value, stepped)
    return verdict(
      oracle,
      differences.length > 0 ? differences : [{ path: '', kind: 'value', expected: 'equal' }]
    )
  }

  return verdict(oracle, findDifferences(value, stepped))
}

/** The structural slice of `SerializedWorkflow` (apps/sim/serializer/types.ts) parity reads. */
interface SerializedWorkflowLike {
  blocks: Array<{
    id: string
    enabled?: boolean
    config: { tool?: string; params: Record<string, unknown> }
    canonicalModes?: Record<string, string>
    retry?: unknown
    metadata?: { id?: string }
  }>
  connections: Array<{
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }>
  loops?: Record<string, unknown>
  parallels?: Record<string, unknown>
}

interface ExecutionParityInput {
  original: WorkflowState
  /** Materialized lockless (no prev, no lock): ids are fresh and aligned here by key. */
  candidate: WorkflowState
  serialize: (state: WorkflowState) => SerializedWorkflowLike
  hasWorkflowChanged: (current: WorkflowState, deployed: WorkflowState) => boolean
  /** `P2` when the candidate went through print and compile too. Default `O2`. */
  oracle?: 'O2' | 'P2'
}

/**
 * O2, execution parity: after aligning the candidate's ids to the original's by block key, the
 * serialized blocks carry the same tool, enabled flag, canonical modes, retry and params (with
 * JSON-string values decoded, so encoding and whitespace do not count), the same connections and
 * subflows, and `hasWorkflowChanged` reports no change.
 */
export function executionParity(input: ExecutionParityInput): OracleResult {
  const aligned = alignWorkflowIds(input.original, input.candidate)
  const expected = executionView(input.serialize(input.original))
  const actual = executionView(input.serialize(aligned))
  const differences = findDifferences(expected, actual)
  if (input.hasWorkflowChanged(aligned, input.original)) {
    differences.push({
      path: '/hasWorkflowChanged',
      kind: 'value',
      expected: 'false',
      actual: 'true',
    })
  }
  return verdict(input.oracle ?? 'O2', differences)
}

/**
 * P4: printed code compiles with zero errors. Warnings and info do not count; each error
 * is reported by code and message.
 */
export function assertNoErrors(
  diagnostics: ReadonlyArray<{ code: string; severity: string; message: string }>
): OracleResult {
  return verdict(
    'P4',
    diagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => ({
        path: diagnostic.code,
        kind: 'value' as const,
        actual: diagnostic.message,
      }))
  )
}

/** The slice of `diffCanonical`'s result P7 reads. */
interface CanonicalDiffLike {
  noop: boolean
  meta: string[]
  blocks: {
    added: string[]
    removed: string[]
    modified: Array<{
      key: string
      changes: Array<{
        kind: string
        param?: string
        canonicalParamId?: string
        attribute?: string
      }>
    }>
  }
  edges: { added: unknown[]; removed: unknown[] }
  variables: { added: string[]; removed: string[]; modified: string[] }
}

/**
 * P7, unchanged source is a no-op apply: the apply path's own diff of the stored workflow against
 * its re-compiled print (`diffCanonical`) finds nothing, so `source apply` of a directory `get`
 * just wrote reports `noop: true`. Each difference names the block and field the diff saw.
 */
export function assertNoopDiff(diff: CanonicalDiffLike): OracleResult {
  if (diff.noop) return { ok: true, oracle: 'P7' }
  const differences: Difference[] = []
  for (const field of diff.meta) differences.push({ path: `/meta/${field}`, kind: 'value' })
  for (const key of diff.blocks.added)
    differences.push({ path: `/blocks/${key}`, kind: 'unexpected' })
  for (const key of diff.blocks.removed)
    differences.push({ path: `/blocks/${key}`, kind: 'missing' })
  for (const block of diff.blocks.modified) {
    for (const change of block.changes) {
      const field = change.param ?? change.canonicalParamId ?? change.attribute ?? change.kind
      differences.push({ path: `/blocks/${block.key}/${field}`, kind: 'value' })
    }
  }
  if (diff.edges.added.length + diff.edges.removed.length > 0) {
    differences.push({ path: '/edges', kind: 'value' })
  }
  for (const key of [
    ...diff.variables.added,
    ...diff.variables.removed,
    ...diff.variables.modified,
  ]) {
    differences.push({ path: `/variables/${key}`, kind: 'value' })
  }
  return verdict('P7', differences.length > 0 ? differences : [{ path: '', kind: 'value' }])
}

/** Container blocks the serializer emits with their raw `block.data` as params. */
const CONTAINER_TYPES: ReadonlySet<string> = new Set(['loop', 'parallel'])

/**
 * What runs. A loop or parallel block's params are its raw `block.data`, echoed by the serializer
 * and read by no handler; the executor runs the container from the `loops` / `parallels` maps it
 * rebuilds from that data (`generateLoopBlocks`), so the container config is compared there.
 */
function executionView(serialized: SerializedWorkflowLike) {
  const blocks: Record<string, unknown> = {}
  for (const block of serialized.blocks) {
    const isContainer = CONTAINER_TYPES.has(block.metadata?.id ?? '')
    setOwn(blocks, block.id, {
      tool: block.config.tool ?? null,
      enabled: block.enabled ?? true,
      canonicalModes: block.canonicalModes ?? {},
      retry: block.retry ?? null,
      params: isContainer ? {} : decodeStructured(block.config.params),
    })
  }
  const connections = serialized.connections
    .map((c) =>
      [c.source, c.sourceHandle ?? 'source', c.target, c.targetHandle ?? 'target'].join('\u0000')
    )
    .sort(compareStrings)
  return {
    blocks,
    connections,
    loops: sortSubflowNodes(serialized.loops ?? {}),
    parallels: sortSubflowNodes(serialized.parallels ?? {}),
  }
}

function sortSubflowNodes(subflows: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [id, config] of Object.entries(subflows)) {
    if (isRecordLike(config) && Array.isArray(config.nodes)) {
      setOwn(out, id, { ...config, nodes: config.nodes.map(String).sort(compareStrings) })
    } else {
      setOwn(out, id, config)
    }
  }
  return out
}

/** Decodes JSON-text strings (objects and arrays only) recursively; everything else as is. */
function decodeStructured(value: unknown): unknown {
  if (typeof value === 'string') {
    const decoded = parseJsonContainer(value)
    return decoded === undefined ? value : decodeStructured(decoded)
  }
  if (Array.isArray(value)) return value.map(decodeStructured)
  if (isRecordLike(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) setOwn(out, key, decodeStructured(child))
    return out
  }
  return value
}

const BRANCH_SUBBLOCK_IDS = ['conditions', 'routes'] as const

function branchRowIds(block: WorkflowState['blocks'][string] | undefined): string[] {
  if (!block) return []
  for (const subBlockId of BRANCH_SUBBLOCK_IDS) {
    const raw = block.subBlocks?.[subBlockId]?.value
    const rows = typeof raw === 'string' ? decodeStructured(raw) : raw
    if (Array.isArray(rows)) {
      return rows.flatMap((row) =>
        isRecordLike(row) && typeof row.id === 'string' ? [row.id] : []
      )
    }
  }
  return []
}

function pairByKey<T>(
  reference: Record<string, T>,
  candidate: Record<string, T>,
  keyOf: (item: T) => string
): Map<string, string> {
  const byKey = new Map<string, string[]>()
  for (const [id, item] of Object.entries(reference)) {
    const key = keyOf(item)
    byKey.set(key, [...(byKey.get(key) ?? []), id])
  }
  const map = new Map<string, string>()
  for (const [id, item] of Object.entries(candidate)) {
    const queue = byKey.get(keyOf(item))
    const target = queue?.shift()
    if (target !== undefined && target !== id) map.set(id, target)
  }
  return map
}

/**
 * Rewrites `candidate`'s ids to `reference`'s: blocks and variables pair by normalized name,
 * condition/router rows by position within paired blocks, and edges by their
 * `(source, sourceHandle, target, targetHandle)` tuple after the block rewrite. Every occurrence of
 * a mapped id (object keys and inside strings, such as `condition-<rowId>` handles) is replaced.
 * Unpaired ids stay as they are, so a real difference still shows up downstream.
 */
function alignWorkflowIds(reference: WorkflowState, candidate: WorkflowState): WorkflowState {
  const map = pairByKey(reference.blocks, candidate.blocks, (block) =>
    normalizeWorkflowBlockName(block.name)
  )

  for (const [candidateId, referenceId] of [...map.entries()]) {
    const fromRows = branchRowIds(candidate.blocks[candidateId])
    const toRows = branchRowIds(reference.blocks[referenceId])
    fromRows.forEach((rowId, index) => {
      const target = toRows[index]
      if (target !== undefined && target !== rowId) map.set(rowId, target)
    })
  }

  for (const [from, to] of pairByKey(reference.variables ?? {}, candidate.variables ?? {}, (v) =>
    normalizeWorkflowBlockName(v.name)
  )) {
    map.set(from, to)
  }

  const rewritten = replaceIds(candidate, map) as WorkflowState

  const edgeKey = (edge: WorkflowState['edges'][number]) =>
    [edge.source, edge.sourceHandle ?? '', edge.target, edge.targetHandle ?? ''].join('\u0000')
  const referenceEdgeIds = new Map(reference.edges.map((edge) => [edgeKey(edge), edge.id]))
  return {
    ...rewritten,
    edges: rewritten.edges.map((edge) => {
      const id = referenceEdgeIds.get(edgeKey(edge))
      return id === undefined ? edge : { ...edge, id }
    }),
  }
}

function replaceIds(value: unknown, map: Map<string, string>): unknown {
  if (map.size === 0) return value
  const ids = [...map.keys()].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(ids.map(escapeRegExp).join('|'), 'g')
  const swap = (text: string) => text.replace(pattern, (match) => map.get(match) ?? match)

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return swap(node)
    if (Array.isArray(node)) return node.map(walk)
    if (isRecordLike(node)) {
      const out: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(node)) setOwn(out, swap(key), walk(child))
      return out
    }
    return node
  }
  return walk(value)
}
