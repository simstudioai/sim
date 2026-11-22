import { isElseConditionTitle, type WorkflowBranchKind } from '@sim/workflow-types/workflow'
import type { BlockState } from '@/stores/workflows/workflow/types'

export interface ConditionRow {
  id: string
  title: string
  value: string
}

export interface RouterRow {
  id: string
  value: string
}

/** A branch's persisted source handle and the row that names it. */
export interface DynamicHandleRow {
  handleId: string
  title: string
  value: string
}

function parseStructuredValue(value: unknown): unknown[] | null {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  return Array.isArray(value) ? value : null
}

export function getDynamicHandleSubblockId(
  blockType: string | undefined
): 'conditions' | 'routes' | null {
  if (blockType === 'condition') return 'conditions'
  if (blockType === 'router_v2') return 'routes'
  return null
}

/** The branch kind of a block whose branches are rows: `condition`, or `router` for router_v2. */
export function getDynamicHandleBranchKind(
  blockType: string | undefined
): WorkflowBranchKind | undefined {
  if (blockType === 'condition') return 'condition'
  if (blockType === 'router_v2') return 'router'
  return undefined
}

export function getDynamicHandleSubblockType(
  blockType: string | undefined
): 'condition-input' | 'router-input' | null {
  if (blockType === 'condition') return 'condition-input'
  if (blockType === 'router_v2') return 'router-input'
  return null
}

export function isDynamicHandleSubblock(
  blockType: string | undefined,
  subblockId: string
): boolean {
  return getDynamicHandleSubblockId(blockType) === subblockId
}

export function getConditionRows(blockId: string, value: unknown): ConditionRow[] {
  const parsed = parseStructuredValue(value)

  if (parsed) {
    const rows = parsed.map((item, index) => {
      const conditionItem = item as { id?: string; value?: unknown }
      const title = index === 0 ? 'if' : index === parsed.length - 1 ? 'else' : 'else if'
      return {
        id: conditionItem?.id ?? `${blockId}-cond-${index}`,
        title,
        value: typeof conditionItem?.value === 'string' ? conditionItem.value : '',
      }
    })

    if (rows.length > 0) {
      return rows
    }
  }

  return [
    { id: `${blockId}-if`, title: 'if', value: '' },
    { id: `${blockId}-else`, title: 'else', value: '' },
  ]
}

export function getRouterRows(blockId: string, value: unknown): RouterRow[] {
  const parsed = parseStructuredValue(value)

  if (parsed) {
    const rows = parsed.map((item, index) => {
      const routeItem = item as { id?: string; value?: string }
      return {
        id: routeItem?.id ?? `${blockId}-route${index + 1}`,
        value: routeItem?.value ?? '',
      }
    })

    if (rows.length > 0) {
      return rows
    }
  }

  return [{ id: `${blockId}-route1`, value: '' }]
}

/** Resolves branch handles and labels from one snapshot, before any comparison. */
export function getDynamicHandleRows(
  block: Pick<BlockState, 'id' | 'type'> & {
    subBlocks: Record<string, { value: unknown }>
  }
): DynamicHandleRow[] {
  if (block.type === 'condition') {
    return getConditionRows(block.id, block.subBlocks.conditions?.value).map((row) => ({
      handleId: `condition-${row.id}`,
      title: row.title,
      value: row.value,
    }))
  }
  if (block.type === 'router_v2') {
    return getRouterRows(block.id, block.subBlocks.routes?.value).map((row, index) => ({
      handleId: `router-${row.id}`,
      title: `Route ${index + 1}`,
      value: row.value,
    }))
  }
  return []
}

/**
 * The source handles of the branches `block` always takes one of (as `respondsOnEveryRun` reads
 * canonical blocks): every route of a router, and a condition's rows up to its first else row (by
 * stored title, as the executor finds it), which runs when none before it matches; none for a
 * condition without one or branches never saved. `undefined` for a block
 * without branches.
 */
export function getAlwaysTakenBranchHandles(
  block: Pick<BlockState, 'id' | 'type'> & { subBlocks: Record<string, { value: unknown }> }
): string[] | undefined {
  const subBlockId = getDynamicHandleSubblockId(block.type)
  if (subBlockId === null) return undefined
  const stored = parseStructuredValue(block.subBlocks[subBlockId]?.value) ?? []
  if (block.type === 'condition') {
    const elseAt = stored.findIndex((row) =>
      isElseConditionTitle((row as { title?: unknown } | null)?.title)
    )
    return elseAt === -1
      ? []
      : getConditionRows(block.id, stored)
          .slice(0, elseAt + 1)
          .map((row) => `condition-${row.id}`)
  }
  return stored.length > 0 ? getRouterRows(block.id, stored).map((row) => `router-${row.id}`) : []
}

export function getDynamicHandleTopologySignature(block: BlockState): string | null {
  if (block.type === 'condition') {
    const rows = getConditionRows(block.id, block.subBlocks?.conditions?.value)
    return `condition:${rows.map((row) => row.id).join('|')}`
  }

  if (block.type === 'router_v2') {
    const rows = getRouterRows(block.id, block.subBlocks?.routes?.value)
    return `router:${rows.map((row) => row.id).join('|')}`
  }

  return null
}

export function collectDynamicHandleTopologySignatures(
  blocks: Record<string, BlockState>
): Map<string, string> {
  const signatures = new Map<string, string>()

  for (const [blockId, block] of Object.entries(blocks)) {
    const signature = getDynamicHandleTopologySignature(block)
    if (signature) {
      signatures.set(blockId, signature)
    }
  }

  return signatures
}

export function getChangedDynamicHandleBlockIds(
  previous: Map<string, string>,
  next: Map<string, string>
): string[] {
  const changedIds: string[] = []

  for (const [blockId, signature] of next) {
    if (previous.get(blockId) !== signature) {
      changedIds.push(blockId)
    }
  }

  return changedIds
}
