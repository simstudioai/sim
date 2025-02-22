'use client'

import { useMemo, useState } from 'react'
import { PanelRight, PanelRightClose, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getAllBlocks, getBlocksByCategory } from '../../../../blocks'
import { BlockCategory, BlockConfig } from '../../../../blocks/types'
import { ToolbarBlock } from './components/toolbar-block/toolbar-block'
import { ToolbarTabs } from './components/toolbar-tabs/toolbar-tabs'

export function Toolbar() {
  const [activeTab, setActiveTab] = useState<BlockCategory>('blocks')
  const [searchQuery, setSearchQuery] = useState('')
  const [isCollapsed, setIsCollapsed] = useState(false)

  const blocks = useMemo(() => {
    const filteredBlocks = !searchQuery.trim() ? getBlocksByCategory(activeTab) : getAllBlocks()

    return filteredBlocks.filter((block) => {
      if (block.type === 'starter') return false
      return (
        !searchQuery.trim() ||
        block.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        block.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    })
  }, [searchQuery, activeTab])

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setIsCollapsed(false)}
            className="fixed left-20 bottom-[18px] z-10 flex h-9 w-9 items-center justify-center rounded-lg bg-background text-muted-foreground transition-colors hover:text-foreground hover:bg-accent border"
          >
            <PanelRight className="h-5 w-5" />
            <span className="sr-only">Open Toolbar</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Open Toolbar</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="fixed left-14 top-16 z-10 h-[calc(100vh-4rem)] w-64 border-r bg-background sm:block">
      <div className="flex flex-col h-full">
        <div className="px-4 pt-4 pb-1 sticky top-0 bg-background z-20">
          <div className="relative">
            <Search className="absolute left-3 top-[50%] h-4 w-4 -translate-y-[50%] text-muted-foreground" />
            <Input
              placeholder="Search blocks..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        {!searchQuery && (
          <div className="sticky top-[72px] bg-background z-20">
            <ToolbarTabs activeTab={activeTab} onTabChange={setActiveTab} />
          </div>
        )}

        <ScrollArea className="h-[calc(100%-4rem)]">
          <div className="p-4 pb-20">
            <div className="flex flex-col gap-3">
              {blocks.map((block) => (
                <ToolbarBlock key={block.type} config={block} />
              ))}
            </div>
          </div>
        </ScrollArea>

        <div className="absolute left-0 right-0 bottom-0 h-16 bg-background border-t">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setIsCollapsed(true)}
                className="absolute right-4 bottom-[18px] flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
              >
                <PanelRightClose className="h-5 w-5" />
                <span className="sr-only">Close Toolbar</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Close Toolbar</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
