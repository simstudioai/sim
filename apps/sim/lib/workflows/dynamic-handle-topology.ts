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

export function isDynamicHandleBlockType(
  type: string | undefined
): type is 'condition' | 'router_v2' {
  return type === 'condition' || type === 'router_v2'
}

export function getDynamicHandleSubblockId(
  blockType: string | undefined
): 'conditions' | 'routes' | null {
  if (blockType === 'condition') return 'conditions'
  if (blockType === 'router_v2') return 'routes'
  return null
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
