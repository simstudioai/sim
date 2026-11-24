import type { Diagnostic } from '@sim/workflow-code'
import {
  type BlockState,
  isWorkflowBlockProtected,
  preserveProtectedWorkflowBlocks,
} from '@sim/workflow-types/workflow'
import { isEqual } from 'es-toolkit'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type GraphDiff,
  isLocked,
  parentIdOf,
  type SourceGraph,
} from '@/lib/workflows/code/apply/graph-diff'

/**
 * The source apply path refuses, and never silently preserves, any change to a locked block:
 * one that is locked or sits inside a locked container. The persistence door keeps
 * locked blocks as stored whatever the incoming graph says, so a source write that changed one
 * would report success while storing something else. This applies to admins too, as the
 * operations engine does; unlocking stays the canvas toggle.
 */

export type LockedBlockDiagnostic = Diagnostic<'E_APPLY_LOCKED_BLOCK'>

function describe(block: BlockState, blocks: Record<string, BlockState>): string {
  const parentId = parentIdOf(block)
  if (!isLocked(block) && parentId && isWorkflowBlockProtected(parentId, blocks)) {
    return `Block "${block.name}" is inside a locked container`
  }
  return `Block "${block.name}" is locked`
}

/**
 * Whether a locked block leaves only because an unlocked container above it was deleted,
 * which the engine and the persistence door both allow (the child goes with its container).
 */
function leavesWithRemovedContainer(id: string, base: SourceGraph, target: SourceGraph): boolean {
  const visited = new Set<string>()
  let parentId = parentIdOf(base.blocks[id])
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    if (!target.blocks[parentId] && !isWorkflowBlockProtected(parentId, base.blocks)) return true
    parentId = parentIdOf(base.blocks[parentId])
  }
  return false
}

/**
 * Returns one refusal per locked block the diff from `base` to `target` touches, plus one per
 * attempt to lock a block or to put a new child into a locked container. Edges into or out of a
 * locked block may not be added or removed, except when the edge goes because its other end
 * was deleted. `keyOf` names a block's source key by id, to locate each refusal.
 */
export function findLockedBlockRefusals(
  base: SourceGraph,
  target: SourceGraph,
  diff: GraphDiff,
  keyOf: (id: string) => string | undefined
): LockedBlockDiagnostic[] {
  const isLockedInBase = (id: string) => isWorkflowBlockProtected(id, base.blocks)
  const nameOf = (id: string) => base.blocks[id]?.name ?? id
  const refusals = new Map<string, LockedBlockDiagnostic>()
  const refuse = (block: BlockState, message: string) => {
    if (refusals.has(block.id)) return
    const blockKey = keyOf(block.id)
    refusals.set(block.id, {
      code: 'E_APPLY_LOCKED_BLOCK',
      severity: 'error',
      message,
      blockId: block.id,
      ...(blockKey !== undefined ? { blockKey } : {}),
      hint: 'Unlock the block on the canvas first, or leave it exactly as it is stored.',
    })
  }

  for (const id of diff.removed) {
    if (isLockedInBase(id) && !leavesWithRemovedContainer(id, base, target)) {
      const block = base.blocks[id]
      refuse(block, `${describe(block, base.blocks)} and cannot be deleted`)
    }
  }

  for (const change of diff.modified) {
    const block = base.blocks[change.id]
    if (isLockedInBase(change.id)) {
      const what = change.lockedChanged
        ? 'its lock cannot be changed from source'
        : change.parentChanged
          ? 'it cannot be moved'
          : `it cannot be edited (${[...change.attributes, ...change.subBlocks.map((id) => `subBlocks.${id}`)].join(', ')})`
      refuse(block, `${describe(block, base.blocks)}; ${what}`)
      continue
    }
    if (change.lockedChanged) {
      refuse(block, `Block "${block.name}" cannot be locked from source; lock it on the canvas`)
      continue
    }
    const parentId = parentIdOf(target.blocks[change.id])
    if (change.parentChanged && parentId && isLockedInBase(parentId)) {
      refuse(
        block,
        `Block "${block.name}" cannot be moved into locked container "${nameOf(parentId)}"`
      )
    }
  }

  for (const id of diff.added) {
    const block = target.blocks[id]
    if (isLocked(block)) {
      refuse(block, `Block "${block.name}" cannot be created locked; lock it on the canvas`)
      continue
    }
    const parentId = parentIdOf(block)
    if (parentId && isLockedInBase(parentId)) {
      refuse(
        block,
        `Block "${block.name}" cannot be added to locked container "${nameOf(parentId)}"`
      )
    }
  }

  const refuseEdge = (endpointId: string, verb: string) => {
    const block = base.blocks[endpointId]
    refuse(block, `${describe(block, base.blocks)}; its connections cannot be ${verb}`)
  }
  for (const edge of diff.edgesAdded) {
    for (const endpoint of [edge.source, edge.target]) {
      if (isLockedInBase(endpoint)) refuseEdge(endpoint, 'added to')
    }
  }
  for (const edge of diff.edgesRemoved) {
    if (!target.blocks[edge.source] || !target.blocks[edge.target]) continue
    for (const endpoint of [edge.source, edge.target]) {
      if (isLockedInBase(endpoint)) refuseEdge(endpoint, 'removed from')
    }
  }

  return [...refusals.values()]
}

function withLockOff(block: BlockState): BlockState {
  return { ...block, locked: isLocked(block) }
}

/**
 * Asserts that the persistence door's locked-block merge leaves `target` unchanged. The
 * source gate refuses every diff that merge would undo, so a difference here means the gate and
 * the merge disagree: an invariant breach, reported as an internal error (HTTP 500) rather than
 * written as a silently merged graph. `current` is the graph re-read under the row lock.
 */
export function assertLockedBlocksPreserved(current: SourceGraph, target: SourceGraph): void {
  const merged = preserveProtectedWorkflowBlocks(current, target)

  const expectedBlocks = new Map(Object.values(target.blocks).map((b) => [b.id, withLockOff(b)]))
  const mergedBlocks = new Map(Object.values(merged.blocks).map((b) => [b.id, withLockOff(b)]))
  const blockMismatch = [...new Set([...expectedBlocks.keys(), ...mergedBlocks.keys()])].find(
    (id) => !isEqual(expectedBlocks.get(id), mergedBlocks.get(id))
  )

  const expectedEdges = new Map(target.edges.map((edge) => [edge.id, edge]))
  const mergedEdges = new Map(merged.edges.map((edge) => [edge.id, edge]))
  const edgeMismatch = [...new Set([...expectedEdges.keys(), ...mergedEdges.keys()])].find(
    (id) => !isEqual(expectedEdges.get(id), mergedEdges.get(id))
  )

  if (blockMismatch !== undefined || edgeMismatch !== undefined) {
    throw new OrchestrationError(
      'internal',
      blockMismatch !== undefined
        ? `Locked-block merge would change block ${blockMismatch}; the source gate let through a change it must refuse`
        : `Locked-block merge would change edge ${edgeMismatch}; the source gate let through a change it must refuse`
    )
  }
}
