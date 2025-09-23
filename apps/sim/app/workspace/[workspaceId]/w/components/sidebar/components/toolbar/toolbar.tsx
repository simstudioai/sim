'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import {
  getBlocksForSidebar,
  getTriggersForSidebar,
  hasTriggerCapability,
} from '@/lib/workflows/trigger-utils'
import { ToolbarBlock } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/toolbar/components/toolbar-block/toolbar-block'
import LoopToolbarItem from '@/app/workspace/[workspaceId]/w/components/sidebar/components/toolbar/components/toolbar-loop-block/toolbar-loop-block'
import ParallelToolbarItem from '@/app/workspace/[workspaceId]/w/components/sidebar/components/toolbar/components/toolbar-parallel-block/toolbar-parallel-block'
import type { WorkspaceUserPermissions } from '@/hooks/use-user-permissions'

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
  const [activeTab, setActiveTab] = useState('blocks')

  const { regularBlocks, specialBlocks, tools, triggers } = useMemo(() => {
    // Get blocks based on the active tab using centralized logic
    const sourceBlocks = activeTab === 'blocks' ? getBlocksForSidebar() : getTriggersForSidebar()

    // Filter blocks based on search query
    const filteredBlocks = sourceBlocks.filter((block) => {
      const matchesSearch =
        !searchQuery.trim() ||
        block.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        block.description.toLowerCase().includes(searchQuery.toLowerCase())

      return matchesSearch
    })

    // Separate blocks by category
    const regularBlockConfigs = filteredBlocks.filter((block) => block.category === 'blocks')
    const toolConfigs = filteredBlocks.filter((block) => block.category === 'tools')
    // For triggers tab, include both 'triggers' category and tools with trigger capability
    const triggerConfigs =
      activeTab === 'triggers'
        ? filteredBlocks
        : filteredBlocks.filter((block) => block.category === 'triggers')

    // Create regular block items and sort alphabetically
    const regularBlockItems: BlockItem[] = regularBlockConfigs
      .map((block) => ({
        name: block.name,
        type: block.type,
        config: block,
        isCustom: false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    // Create special blocks (loop and parallel) only for blocks tab
    const specialBlockItems: BlockItem[] = []

    if (activeTab === 'blocks') {
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
    }

    // Sort special blocks alphabetically
    specialBlockItems.sort((a, b) => a.name.localeCompare(b.name))

    // Create trigger block items and sort alphabetically
    const triggerBlockItems: BlockItem[] = triggerConfigs
      .map((block) => ({
        name: block.name,
        type: block.type,
        config: block,
        isCustom: false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    // Sort tools alphabetically
    toolConfigs.sort((a, b) => a.name.localeCompare(b.name))

    return {
      regularBlocks: regularBlockItems,
      specialBlocks: specialBlockItems,
      tools: toolConfigs,
      triggers: triggerBlockItems,
    }
  }, [searchQuery, activeTab])

  return (
    <div className='flex h-full flex-col'>
      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className='flex h-full flex-col'>
        <div className='flex-shrink-0 px-2 pt-2'>
          <div className='flex h-9 w-full items-center gap-1 rounded-[10px] border bg-card px-[2.5px] py-1 shadow-xs'>
            <button
              onClick={() => setActiveTab('blocks')}
              className={`panel-tab-base inline-flex flex-1 cursor-pointer items-center justify-center rounded-[8px] border border-transparent py-1 font-[450] text-sm outline-none transition-colors duration-200 ${
                activeTab === 'blocks' ? 'panel-tab-active' : 'panel-tab-inactive'
              }`}
            >
              Blocks
            </button>
            <button
              onClick={() => setActiveTab('triggers')}
              className={`panel-tab-base inline-flex flex-1 cursor-pointer items-center justify-center rounded-[8px] border border-transparent py-1 font-[450] text-sm outline-none transition-colors duration-200 ${
                activeTab === 'triggers' ? 'panel-tab-active' : 'panel-tab-inactive'
              }`}
            >
              Triggers
            </button>
          </div>
        </div>

        {/* Search */}
        <div className='flex-shrink-0 p-2'>
          <div className='flex h-9 items-center gap-2 rounded-[8px] border bg-background pr-2 pl-3'>
            <Search className='h-4 w-4 text-muted-foreground' strokeWidth={2} />
            <Input
              placeholder={activeTab === 'blocks' ? 'Search blocks...' : 'Search triggers...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className='h-6 flex-1 border-0 bg-transparent px-0 text-muted-foreground text-sm leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
              autoComplete='off'
              autoCorrect='off'
              autoCapitalize='off'
              spellCheck='false'
            />
          </div>
        </div>

        {/* Blocks Tab Content */}
        <TabsContent value='blocks' className='mt-0 flex-1 overflow-hidden'>
          <ScrollArea className='h-full px-2' hideScrollbar={true}>
            <div className='space-y-1 pb-2'>
              {/* Regular Blocks */}
              {regularBlocks.map((block) => (
                <ToolbarBlock
                  key={block.type}
                  config={block.config}
                  disabled={!userPermissions.canEdit}
                />
              ))}

              {/* Special Blocks (Loop & Parallel) */}
              {specialBlocks.map((block) => {
                if (block.type === 'loop') {
                  return <LoopToolbarItem key={block.type} disabled={!userPermissions.canEdit} />
                }
                if (block.type === 'parallel') {
                  return (
                    <ParallelToolbarItem key={block.type} disabled={!userPermissions.canEdit} />
                  )
                }
                return null
              })}

              {/* Tools */}
              {tools.map((tool) => (
                <ToolbarBlock key={tool.type} config={tool} disabled={!userPermissions.canEdit} />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Triggers Tab Content */}
        <TabsContent value='triggers' className='mt-0 flex-1 overflow-hidden'>
          <ScrollArea className='h-full px-2' hideScrollbar={true}>
            <div className='space-y-1 pb-2'>
              {triggers.length > 0 ? (
                triggers.map((trigger) => (
                  <ToolbarBlock
                    key={trigger.type}
                    config={trigger.config}
                    disabled={!userPermissions.canEdit}
                    enableTriggerMode={hasTriggerCapability(trigger.config)}
                  />
                ))
              ) : (
                <div className='py-8 text-center text-muted-foreground text-sm'>
                  {searchQuery ? 'No triggers found' : 'Add triggers from the workflow canvas'}
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  )
}
