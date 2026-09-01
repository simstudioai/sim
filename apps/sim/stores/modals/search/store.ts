import { Repeat, Split } from '@sim/emcn/icons'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { isOperationAllowed } from '@/lib/permission-groups/operation-access'
import { toSearchToken } from '@/lib/search/tokens'
import { getToolOperationsIndex } from '@/lib/search/tool-operations'
import { getTriggersForSidebar } from '@/lib/workflows/triggers/trigger-utils'
import { getAllBlocks, getBlock } from '@/blocks'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type {
  SearchBlockItem,
  SearchData,
  SearchModalState,
  SearchToolOperationItem,
} from './types'

const initialData: SearchData = {
  blocks: [],
  tools: [],
  triggers: [],
  toolOperations: [],
  isInitialized: false,
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

export function buildCommandSearchableOptionSearchValue(block: BlockConfig): string {
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

export const useSearchModalStore = create<SearchModalState>()(
  devtools(
    (set, _) => ({
      isOpen: false,
      data: initialData,

      setOpen: (open: boolean) => {
        set({ isOpen: open })
      },

      open: () => {
        set({ isOpen: true })
      },

      close: () => {
        set({ isOpen: false })
      },

      initializeData: (filterBlocks, isToolAllowed) => {
        const allBlocks = getAllBlocks()
        const filteredAllBlocks = filterBlocks(allBlocks) as typeof allBlocks

        const regularBlocks: SearchBlockItem[] = []
        const tools: SearchBlockItem[] = []

        for (const block of filteredAllBlocks) {
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

        const specialBlocks: SearchBlockItem[] = [
          {
            id: 'loop',
            name: 'Loop',
            icon: Repeat,
            bgColor: '#2FB3FF',
            type: 'loop',
          },
          {
            id: 'parallel',
            name: 'Parallel',
            icon: Split,
            bgColor: '#FEE12B',
            type: 'parallel',
          },
        ]

        const blocks = [...regularBlocks, ...(filterBlocks(specialBlocks) as SearchBlockItem[])]

        const allTriggers = getTriggersForSidebar()
        const filteredTriggers = filterBlocks(allTriggers) as typeof allTriggers
        const priorityOrder = ['Start', 'Schedule', 'Webhook Trigger']

        const sortedTriggers = [...filteredTriggers].sort(
          (a: (typeof filteredTriggers)[number], b: (typeof filteredTriggers)[number]) => {
            const aIndex = priorityOrder.indexOf(a.name)
            const bIndex = priorityOrder.indexOf(b.name)
            const aHasPriority = aIndex !== -1
            const bHasPriority = bIndex !== -1

            if (aHasPriority && bHasPriority) return aIndex - bIndex
            if (aHasPriority) return -1
            if (bHasPriority) return 1
            return a.name.localeCompare(b.name)
          }
        )

        const triggers = sortedTriggers.map(
          (block): SearchBlockItem => ({
            id: block.type,
            name: block.name,
            icon: block.icon,
            bgColor: block.bgColor || '#6B7280',
            type: block.type,
            config: block,
          })
        )

        const allowedBlockTypes = new Set(tools.map((t) => t.type))
        const toolOperations: SearchToolOperationItem[] = getToolOperationsIndex()
          .filter((op) => allowedBlockTypes.has(op.blockType))
          /* Selecting a result drops a block already set to that operation, so
             the group's tool denylist has to apply here too — the block-level
             allowlist above only decides whether the integration is offered. */
          .filter((op) => isOperationAllowed(getBlock(op.blockType), op.operationId, isToolAllowed))
          .map((op) => {
            const aliasesStr = op.aliases?.length
              ? ` ${op.aliases.map(toSearchToken).join(' ')}`
              : ''
            return {
              id: op.id,
              name: op.operationName,
              serviceName: op.serviceName,
              searchValue: `${toSearchToken(op.serviceName)} ${toSearchToken(op.operationName)}${aliasesStr}`,
              icon: op.icon,
              bgColor: op.bgColor,
              blockType: op.blockType,
              operationId: op.operationId,
            }
          })

        set({
          data: {
            blocks,
            tools,
            triggers,
            toolOperations,
            isInitialized: true,
          },
        })
      },
    }),
    { name: 'search-modal-store' }
  )
)
