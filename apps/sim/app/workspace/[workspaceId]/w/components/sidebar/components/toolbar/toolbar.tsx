'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getAllBlocks } from '@/blocks'
import type { WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import { ToolbarBlock } from './components/toolbar-block/toolbar-block'
import LoopToolbarItem from './components/toolbar-loop-block/toolbar-loop-block'
import ParallelToolbarItem from './components/toolbar-parallel-block/toolbar-parallel-block'

interface ToolbarProps {
  userPermissions: WorkspaceUserPermissions
  isWorkspaceSelectorVisible?: boolean
}

interface BlockItem {
  name: string
  type: string
  isCustom: boolean
  config?: any
}

export function Toolbar({ userPermissions, isWorkspaceSelectorVisible = false }: ToolbarProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const { regularBlocks, specialBlocks, tools } = useMemo(() => {
    const allBlocks = getAllBlocks()

    // Filter blocks based on search query
    const filteredBlocks = allBlocks.filter((block) => {
      if (block.type === 'starter' || block.hideFromToolbar) return false

      return (
        !searchQuery.trim() ||
        block.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        block.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    })

    // Separate regular blocks (category: 'blocks') and tools (category: 'tools')
    const regularBlockConfigs = filteredBlocks.filter((block) => block.category === 'blocks')
    const toolConfigs = filteredBlocks.filter((block) => block.category === 'tools')

    // Create regular block items and sort alphabetically
    const regularBlockItems: BlockItem[] = regularBlockConfigs
      .map((block) => ({
        name: block.name,
        type: block.type,
        config: block,
        isCustom: false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    // Create special blocks (loop and parallel) if they match search
    const specialBlockItems: BlockItem[] = []

    if (!searchQuery.trim() || 'loop'.toLowerCase().includes(searchQuery.toLowerCase())) {
      specialBlockItems.push({
        name: 'Loop',
        type: 'loop',
        isCustom: true,
      })
    }

    if (!searchQuery.trim() || 'parallel'.toLowerCase().includes(searchQuery.toLowerCase())) {
      specialBlockItems.push({
        name: 'Parallel',
        type: 'parallel',
        isCustom: true,
      })
    }

    // Sort special blocks alphabetically
    specialBlockItems.sort((a, b) => a.name.localeCompare(b.name))

    // Sort tools alphabetically
    toolConfigs.sort((a, b) => a.name.localeCompare(b.name))

    return {
      regularBlocks: regularBlockItems,
      specialBlocks: specialBlockItems,
      tools: toolConfigs,
    }
  }, [searchQuery])

  return (
    <div className='flex h-full flex-col'>
      {/* Search */}
      <div className='flex-shrink-0 p-2'>
        <div className='flex h-9 items-center gap-2 rounded-[10px] border bg-background pr-2 pl-3'>
          <Search className='h-4 w-4 text-muted-foreground' strokeWidth={2} />
          <Input
            placeholder='Search blocks...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='h-6 flex-1 border-0 bg-transparent px-0 font-normal text-muted-foreground text-sm leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
            autoComplete='off'
            autoCorrect='off'
            autoCapitalize='off'
            spellCheck='false'
          />
        </div>
      </div>

      {/* Content */}
      <ScrollArea className='flex-1 px-2' hideScrollbar={true}>
        <div className='space-y-1 pb-2'>
          {/* Regular Blocks Section */}
          {regularBlocks.map((block) => (
            <ToolbarBlock
              key={block.type}
              config={block.config}
              disabled={!userPermissions.canEdit}
            />
          ))}

          {/* Special Blocks Section (Loop & Parallel) */}
          {specialBlocks.map((block) => {
            if (block.type === 'loop') {
              return <LoopToolbarItem key={block.type} disabled={!userPermissions.canEdit} />
            }
            if (block.type === 'parallel') {
              return <ParallelToolbarItem key={block.type} disabled={!userPermissions.canEdit} />
            }
            return null
          })}

          {/* Tools Section */}
          {tools.map((tool) => (
            <ToolbarBlock key={tool.type} config={tool} disabled={!userPermissions.canEdit} />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
