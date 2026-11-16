/**
 * Glue between `workflow.code_meta` (keyed by block id) and the key-keyed world of the printer,
 * the compiler and the lock (build-spec decisions 4 and 6).
 *
 * Read path (`getWorkflowSource`): canonicalize the stored graph, turn `code_meta` into printer
 * inputs with {@link codeMetaPrintInputs}, print, then assemble the lock with
 * {@link buildLockFromState} from the canonical identity and the hints the printer returned.
 *
 * Write path (`applyWorkflowSource`): after a successful apply, {@link mergeCodeMetaFromLock}
 * re-keys the compiled bindings, order and comments onto the ids the lock now holds, and the
 * result is stored back.
 */

import { compareStrings } from '@sim/utils/string'
import {
  type AnchorKey,
  assignIdentifiers,
  type BlockKey,
  type CanonicalizeResult,
  type CanonicalWorkflow,
  type CodeComment,
  codeMetaExtensions,
  decodeAnchor,
  encodeAnchor,
  type LockHints,
  mapAnchorIds,
  SDK_RESERVED_IDENTIFIERS,
  type WorkflowCodeMetaV1,
  type WorkflowLockBlock,
  type WorkflowLockV1,
} from '@sim/workflow-code'

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function isUsableBinding(binding: string | undefined): binding is string {
  return binding !== undefined && IDENTIFIER.test(binding) && !SDK_RESERVED_IDENTIFIERS.has(binding)
}

/** Re-maps the block and variable segments of comment anchors; an anchor mapped to `null` is dropped. */
function rekeyComments(
  comments: Partial<Record<AnchorKey, CodeComment[]>>,
  block: (segment: string) => string | null,
  variable: (segment: string) => string | null
): Partial<Record<AnchorKey, CodeComment[]>> {
  const result: Partial<Record<AnchorKey, CodeComment[]>> = {}
  for (const [key, list] of Object.entries(comments)) {
    const anchor = decodeAnchor(key)
    const mapped = anchor ? mapAnchorIds(anchor, block, variable) : null
    if (!mapped || !list || list.length === 0) continue
    const mappedKey = encodeAnchor(mapped)
    result[mappedKey] = [...(result[mappedKey] ?? []), ...list]
  }
  return result
}

function invert(record: Record<string, string>): Map<string, string> {
  const inverse = new Map<string, string>()
  for (const [key, id] of Object.entries(record)) {
    if (!inverse.has(id)) inverse.set(id, key)
  }
  return inverse
}

export interface CodeMetaPrintInputs {
  /** `binding` and `order` per block key, for `PrintInput.hints`. */
  hints: LockHints
  /** Key-anchored comments, for `workflow.annotations.comments` before printing. */
  comments: Partial<Record<AnchorKey, CodeComment[]>>
}

/**
 * Projects `code_meta` onto the keys canonicalize assigned. Entries for ids the stored graph no
 * longer holds are ignored, so a stale (unpruned) entry never reaches a print.
 */
export function codeMetaPrintInputs(
  codeMeta: WorkflowCodeMetaV1 | null,
  canonical: Pick<CanonicalizeResult, 'identity'>
): CodeMetaPrintInputs {
  const hints: LockHints = { blocks: {} }
  if (!codeMeta) return { hints, comments: {} }
  const keyById = invert(
    Object.fromEntries(Object.entries(canonical.identity.blocks).map(([key, b]) => [key, b.id]))
  )
  const varKeyById = invert(canonical.identity.variables)
  for (const [key, block] of Object.entries(canonical.identity.blocks)) {
    const binding = codeMeta.bindings[block.id]
    const order = codeMeta.order[block.id]
    hints.blocks[key] = {
      ...(binding !== undefined && { binding }),
      ...(order !== undefined && { order }),
    }
  }
  return {
    hints,
    comments: rekeyComments(
      codeMeta.comments,
      (id) => keyById.get(id) ?? null,
      (id) => varKeyById.get(id) ?? null
    ),
  }
}

/**
 * Assembles the full lock for a stored graph: ids, parents, branches, items and layout from
 * canonicalize; `binding` and `order` from `printed` (the hints `printWorkflow` returned, which
 * is what the file holds), then `code_meta`, then derived values.
 *
 * Derived bindings are camelCase from the display name (`assignIdentifiers`). Derived orders sort
 * after every stored order, by key, which is exactly how the printer orders blocks without one.
 * Pass `printed` whenever a file was printed, so the lock and the file always agree.
 */
export function buildLockFromState(
  codeMeta: WorkflowCodeMetaV1 | null,
  canonical: Pick<CanonicalizeResult, 'identity' | 'layout' | 'workflow'>,
  printed?: LockHints
): WorkflowLockV1 {
  const { identity, layout, workflow } = canonical
  const keys = Object.keys(identity.blocks).sort(compareStrings)

  const orderOf = new Map<BlockKey, number>()
  for (const key of keys) {
    const id = identity.blocks[key].id
    const order = printed?.blocks[key]?.order ?? codeMeta?.order[id]
    if (order !== undefined && Number.isSafeInteger(order) && order >= 0) orderOf.set(key, order)
  }
  let next = Math.max(-1, ...orderOf.values()) + 1
  for (const key of keys) {
    if (!orderOf.has(key)) orderOf.set(key, next++)
  }

  const declarationOrder = [...keys].sort(
    (a, b) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0) || compareStrings(a, b)
  )
  const bindings = assignIdentifiers(
    declarationOrder.map((key) => {
      const id = identity.blocks[key].id
      const candidates = [printed?.blocks[key]?.binding, codeMeta?.bindings[id]]
      return {
        key,
        name: workflow.blocks[key]?.name ?? key,
        hint: candidates.find(isUsableBinding),
      }
    }),
    new Set()
  )

  const blocks: Record<BlockKey, WorkflowLockBlock> = {}
  for (const key of keys) {
    const entry = identity.blocks[key]
    const codeFile = printed?.blocks[key]?.codeFile
    blocks[key] = {
      id: entry.id,
      parent: entry.parent,
      ...(entry.branches && { branches: { ...entry.branches } }),
      ...(entry.items && { items: structuredClone(entry.items) }),
      binding: bindings.get(key) ?? key,
      order: orderOf.get(key) ?? 0,
      ...(layout[key] && { layout: { ...layout[key] } }),
      ...(codeFile && { codeFile }),
    }
  }
  return { lockVersion: 1, blocks, variables: { ...identity.variables } }
}

/**
 * The `code_meta` to store after a successful apply: the compiled file's bindings, declaration
 * order and comments, re-keyed from block keys to the ids in `lock` (the post-materialize lock).
 * Bindings or orders the file does not state fall back to the lock's. Blocks and variables the
 * lock does not hold are dropped, and `x-` extensions of `prevMeta` are kept.
 */
export function mergeCodeMetaFromLock(
  prevMeta: WorkflowCodeMetaV1 | null,
  lock: Pick<WorkflowLockV1, 'blocks' | 'variables'>,
  compiled: { hints: LockHints; workflow: Pick<CanonicalWorkflow, 'annotations'> }
): WorkflowCodeMetaV1 {
  const bindings: Record<string, string> = {}
  const order: Record<string, number> = {}
  const taken = new Set<string>()
  for (const key of Object.keys(lock.blocks).sort(compareStrings)) {
    const block = lock.blocks[key]
    const hint = compiled.hints.blocks[key]
    const binding = [hint?.binding, block.binding].find(
      (candidate) => isUsableBinding(candidate) && !taken.has(candidate)
    )
    if (binding !== undefined) {
      bindings[block.id] = binding
      taken.add(binding)
    }
    order[block.id] = hint?.order ?? block.order
  }
  const comments = rekeyComments(
    compiled.workflow.annotations.comments,
    (key) => (Object.hasOwn(lock.blocks, key) ? lock.blocks[key].id : null),
    (key) => (Object.hasOwn(lock.variables, key) ? lock.variables[key] : null)
  )
  return {
    ...(prevMeta ? codeMetaExtensions(prevMeta) : {}),
    v: 1,
    bindings,
    order,
    comments,
  }
}
