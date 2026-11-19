/**
 * Glue between `workflow_source_meta` (keyed by block id) and the key-keyed world of the printer,
 * the compiler and the lock.
 *
 * Read path (`readWorkflowSource`): canonicalize the stored graph, turn source meta into printer
 * inputs with {@link hintsFromSourceMeta}, print, then assemble the lock with
 * {@link buildLockFromState} from the canonical identity and the hints the printer returned.
 *
 * Write path (`applyWorkflowSource`): after a successful apply, {@link mergeSourceMetaFromLock}
 * re-keys the compiled idents, order and comments onto the ids the lock now holds, and the
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
  decodeAnchor,
  encodeAnchor,
  invertRecord,
  mapAnchorIds,
  readIdent,
  type SourceHints,
  setOwn,
  sourceMetaExtensions,
  type WorkflowLockBlock,
  type WorkflowLockV1,
  type WorkflowSourceMetaV1,
} from '@sim/workflow-code'

function isUsableIdent(ident: string | undefined): ident is string {
  return ident !== undefined && 'ident' in readIdent(ident)
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

/** Source meta projected onto canonical keys, ready to pass to a print. */
export interface SourceMetaPrintInputs {
  /** `ident` and `order` per block key, for `PrintInput.hints`. */
  hints: SourceHints
  /** Key-anchored comments, for `workflow.annotations.comments` before printing. */
  comments: Partial<Record<AnchorKey, CodeComment[]>>
}

/**
 * Projects source meta onto the keys canonicalize assigned. Entries for ids the stored graph no
 * longer holds are ignored, so a stale (unpruned) entry never reaches a print.
 */
export function hintsFromSourceMeta(
  sourceMeta: WorkflowSourceMetaV1 | null,
  canonical: Pick<CanonicalizeResult, 'identity'>
): SourceMetaPrintInputs {
  const hints: SourceHints = { blocks: {} }
  if (!sourceMeta) return { hints, comments: {} }
  const keyById = invertRecord(
    Object.fromEntries(Object.entries(canonical.identity.blocks).map(([key, b]) => [key, b.id]))
  )
  const varKeyById = invertRecord(canonical.identity.variables)
  for (const [key, block] of Object.entries(canonical.identity.blocks)) {
    const ident = sourceMeta.idents[block.id]
    const order = sourceMeta.order[block.id]
    setOwn(hints.blocks, key, {
      ...(ident !== undefined && { ident }),
      ...(order !== undefined && { order }),
    })
  }
  return {
    hints,
    comments: rekeyComments(
      sourceMeta.comments,
      (id) => keyById.get(id) ?? null,
      (id) => varKeyById.get(id) ?? null
    ),
  }
}

/**
 * Assembles the full lock for a stored graph: ids, parents, branches, items and layout from
 * canonicalize; `ident` and `order` from `printed` (the hints `printWorkflow` returned, which
 * is what the file holds), then source meta, then derived values.
 *
 * Derived idents are camelCase from the display name (`assignIdentifiers`). Derived orders sort
 * after every stored order, by key, which is exactly how the printer orders blocks without one.
 * Pass `printed` whenever a file was printed, so the lock and the file always agree.
 */
export function buildLockFromState(
  sourceMeta: WorkflowSourceMetaV1 | null,
  canonical: Pick<CanonicalizeResult, 'identity' | 'layout' | 'workflow'>,
  printed?: SourceHints
): WorkflowLockV1 {
  const { identity, layout, workflow } = canonical
  const keys = Object.keys(identity.blocks).sort(compareStrings)

  const orderOf = new Map<BlockKey, number>()
  for (const key of keys) {
    const id = identity.blocks[key].id
    const order = printed?.blocks[key]?.order ?? sourceMeta?.order[id]
    if (order !== undefined && Number.isSafeInteger(order) && order >= 0) orderOf.set(key, order)
  }
  let next = Math.max(-1, ...orderOf.values()) + 1
  for (const key of keys) {
    if (!orderOf.has(key)) orderOf.set(key, next++)
  }

  const declarationOrder = [...keys].sort(
    (a, b) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0) || compareStrings(a, b)
  )
  const idents = assignIdentifiers(
    declarationOrder.map((key) => {
      const id = identity.blocks[key].id
      const candidates = [printed?.blocks[key]?.ident, sourceMeta?.idents[id]]
      return {
        key,
        name: workflow.blocks[key]?.name ?? key,
        hint: candidates.find(isUsableIdent),
      }
    }),
    new Set()
  )

  const blocks: Record<BlockKey, WorkflowLockBlock> = {}
  for (const key of keys) {
    const entry = identity.blocks[key]
    const codeFile = printed?.blocks[key]?.codeFile
    setOwn(blocks, key, {
      id: entry.id,
      parent: entry.parent,
      ...(entry.branches && { branches: { ...entry.branches } }),
      ...(entry.items && { items: structuredClone(entry.items) }),
      ident: idents.get(key) ?? key,
      order: orderOf.get(key) ?? 0,
      ...(layout[key] && { layout: { ...layout[key] } }),
      ...(codeFile && { codeFile }),
    })
  }
  return { version: 1, blocks, variables: { ...identity.variables } }
}

/**
 * The source meta to store after a successful apply: the compiled file's idents, declaration
 * order and comments, re-keyed from block keys to the ids in `lock` (the post-materialize lock).
 * Idents or orders the file does not state fall back to the lock's. Blocks and variables the
 * lock does not hold are dropped, and `x-` extensions of `prevMeta` are kept.
 */
export function mergeSourceMetaFromLock(
  prevMeta: WorkflowSourceMetaV1 | null,
  lock: Pick<WorkflowLockV1, 'blocks' | 'variables'>,
  compiled: { hints: SourceHints; workflow: Pick<CanonicalWorkflow, 'annotations'> }
): WorkflowSourceMetaV1 {
  const idents: Record<string, string> = {}
  const order: Record<string, number> = {}
  const taken = new Set<string>()
  for (const key of Object.keys(lock.blocks).sort(compareStrings)) {
    const block = lock.blocks[key]
    const hint = compiled.hints.blocks[key]
    const ident = [hint?.ident, block.ident].find(
      (candidate) => isUsableIdent(candidate) && !taken.has(candidate)
    )
    if (ident !== undefined) {
      idents[block.id] = ident
      taken.add(ident)
    }
    order[block.id] = hint?.order ?? block.order
  }
  const comments = rekeyComments(
    compiled.workflow.annotations.comments,
    (key) => (Object.hasOwn(lock.blocks, key) ? lock.blocks[key].id : null),
    (key) => (Object.hasOwn(lock.variables, key) ? lock.variables[key] : null)
  )
  return {
    ...(prevMeta ? sourceMetaExtensions(prevMeta) : {}),
    version: 1,
    idents,
    order,
    comments,
  }
}
