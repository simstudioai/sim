import type { ComponentType } from 'react'
import { Repeat, Split } from '@sim/emcn-legacy/icons'
import { type IsToolAllowed, isOperationAllowed } from '@/lib/permission-groups/operation-access'
import { toSearchToken } from '@/lib/search/tokens'
import { getToolOperationsIndex } from '@/lib/search/tool-operations'
import { getAllBlocks, getBlock } from '@/blocks'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

/** A block or tool the canvas block picker offers. */
export interface SearchBlockItem {
  id: string
  name: string
  icon: ComponentType<{ className?: string }>
  bgColor: string
  type: string
  searchValue?: string
  /** Custom blocks only: bound source workflow id — hidden on that workflow's canvas. */
  sourceWorkflowId?: string
}

/** A single operation of a tool block, offered so picking it presets that operation. */
export interface SearchToolOperationItem {
  id: string
  name: string
  serviceName: string
  searchValue: string
  icon: ComponentType<{ className?: string }>
  bgColor: string
  blockType: string
  operationId: string
}

/** Everything the canvas block picker can offer the viewer. */
export interface BlockSearchIndex {
  blocks: SearchBlockItem[]
  tools: SearchBlockItem[]
  toolOperations: SearchToolOperationItem[]
}

type CommandSearchableOption = {
  label: string
  id: string
  hidden?: boolean
}

function getCommandSearchableOptions(subBlock: SubBlockConfig): CommandSearchableOption[] {
  if (!subBlock.options) return []

  try {
    const options = typeof subBlock.options === 'function' ? subBlock.options() : subBlock.options
    return Array.isArray(options) ? options : []
  } catch {
    return []
  }
}

function buildCommandSearchableOptionSearchValue(block: BlockConfig): string {
  const terms = new Set<string>()

  for (const subBlock of block.subBlocks) {
    if (
      (subBlock.type !== 'dropdown' && subBlock.type !== 'combobox') ||
      !subBlock.commandSearchable
    ) {
      continue
    }

    for (const option of getCommandSearchableOptions(subBlock)) {
      if (option.hidden) continue

      const subBlockTitle = subBlock.title ?? subBlock.id
      terms.add(toSearchToken(subBlockTitle))
      terms.add(toSearchToken(option.label))
      terms.add(option.id)
    }
  }

  return Array.from(terms).join(' ')
}

const SUBFLOW_BLOCKS: SearchBlockItem[] = [
  { id: 'loop', name: 'Loop', icon: Repeat, bgColor: '#2FB3FF', type: 'loop' },
  { id: 'parallel', name: 'Parallel', icon: Split, bgColor: '#FEE12B', type: 'parallel' },
]

/**
 * Builds the blocks, tools and tool operations the viewer may add, from the registry as it stands
 * now. `filterBlocks` drops integrations the viewer's permission group or deployment withholds;
 * `isToolAllowed` drops operations whose tool the group denies. Searchable dropdown options can
 * list provider models, so callers rebuild when those or the custom-block overlay change.
 */
export function buildBlockSearchIndex(
  filterBlocks: <T extends { type: string }>(blocks: T[]) => T[],
  isToolAllowed: IsToolAllowed
): BlockSearchIndex {
  const regularBlocks: SearchBlockItem[] = []
  const tools: SearchBlockItem[] = []

  for (const block of filterBlocks(getAllBlocks())) {
    if (block.hideFromToolbar) continue

    const searchItem: SearchBlockItem = {
      id: block.type,
      name: block.name,
      icon: block.icon,
      bgColor: block.bgColor || '#6B7280',
      type: block.type,
      searchValue: `${toSearchToken(block.name)} ${block.type} ${buildCommandSearchableOptionSearchValue(block)}`,
      sourceWorkflowId: block.sourceWorkflowId,
    }

    if (block.category === 'blocks' && block.type !== 'starter') {
      regularBlocks.push(searchItem)
    } else if (block.category === 'tools') {
      tools.push(searchItem)
    }
  }

  const allowedBlockTypes = new Set(tools.map((tool) => tool.type))
  const toolOperations: SearchToolOperationItem[] = getToolOperationsIndex()
    .filter((op) => allowedBlockTypes.has(op.blockType))
    /* Selecting a result drops a block already set to that operation, so the group's tool
       denylist applies here too; the block-level filter only decides whether the integration
       is offered. */
    .filter((op) => isOperationAllowed(getBlock(op.blockType), op.operationId, isToolAllowed))
    .map((op) => {
      const aliases = op.aliases?.length ? ` ${op.aliases.map(toSearchToken).join(' ')}` : ''
      return {
        id: op.id,
        name: op.operationName,
        serviceName: op.serviceName,
        searchValue: `${toSearchToken(op.serviceName)} ${toSearchToken(op.operationName)}${aliases}`,
        icon: op.icon,
        bgColor: op.bgColor,
        blockType: op.blockType,
        operationId: op.operationId,
      }
    })

  return {
    blocks: [...regularBlocks, ...filterBlocks(SUBFLOW_BLOCKS)],
    tools,
    toolOperations,
  }
}
