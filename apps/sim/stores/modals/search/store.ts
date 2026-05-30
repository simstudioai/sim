import { RepeatIcon, SplitIcon } from 'lucide-react'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { getToolOperationsIndex } from '@/lib/search/tool-operations'
import { getTriggersForSidebar } from '@/lib/workflows/triggers/trigger-utils'
import { getAllBlocks } from '@/blocks'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type {
  SearchBlockItem,
  SearchData,
  SearchDocItem,
  SearchModalState,
  SearchToolOperationItem,
} from './types'

const initialData: SearchData = {
  blocks: [],
  tools: [],
  triggers: [],
  toolOperations: [],
  docs: [],
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
      terms.add(subBlockTitle)
      terms.add(option.label)
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

      initializeData: (filterBlocks) => {
        const allBlocks = getAllBlocks()
        const filteredAllBlocks = filterBlocks(allBlocks) as typeof allBlocks

        const regularBlocks: SearchBlockItem[] = []
        const tools: SearchBlockItem[] = []
        const docs: SearchDocItem[] = []

        for (const block of filteredAllBlocks) {
          if (block.hideFromToolbar) continue

          const searchItem: SearchBlockItem = {
            id: block.type,
            name: block.name,
            icon: block.icon,
            bgColor: block.bgColor || '#6B7280',
            type: block.type,
            searchValue: `${block.name} ${block.type} block-${block.type} ${buildCommandSearchableOptionSearchValue(block)}`,
          }

          if (block.category === 'blocks' && block.type !== 'starter') {
            regularBlocks.push(searchItem)
          } else if (block.category === 'tools') {
            tools.push(searchItem)
          }

          if (block.docsLink) {
            docs.push({
              id: `docs-${block.type}`,
              name: block.name,
              icon: block.icon,
              href: block.docsLink,
            })
          }
        }

        const specialBlocks: SearchBlockItem[] = [
          {
            id: 'loop',
            name: 'Loop',
            icon: RepeatIcon,
            bgColor: '#2FB3FF',
            type: 'loop',
          },
          {
            id: 'parallel',
            name: 'Parallel',
            icon: SplitIcon,
            bgColor: '#FEE12B',
            type: 'parallel',
          },
        ]

        const blocks = [...regularBlocks, ...(filterBlocks(specialBlocks) as SearchBlockItem[])]

        const allTriggers = getTriggersForSidebar()
        const filteredTriggers = filterBlocks(allTriggers) as typeof allTriggers
        const priorityOrder = ['Start', 'Schedule', 'Webhook']

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
          .map((op) => {
            const aliasesStr = op.aliases?.length ? ` ${op.aliases.join(' ')}` : ''
            return {
              id: op.id,
              name: op.operationName,
              searchValue: `${op.serviceName} ${op.operationName}${aliasesStr}`,
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
            docs,
            isInitialized: true,
          },
        })
      },
    }),
    { name: 'search-modal-store' }
  )
)
