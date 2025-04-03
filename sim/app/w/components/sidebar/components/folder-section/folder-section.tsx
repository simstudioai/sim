'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Folder, LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { NavItem } from '../nav-item/nav-item'

interface FolderSectionProps {
  title: string
  workflows: WorkflowMetadata[]
  defaultOpen?: boolean
  icon?: LucideIcon
}

export function FolderSection({
  title,
  workflows,
  defaultOpen = true,
  icon: Icon = Folder,
}: FolderSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const pathname = usePathname()

  // Auto-expand the folder if the current path is one of the workflows inside it
  useEffect(() => {
    const isCurrentPathInThisFolder = workflows.some((workflow) => pathname === `/w/${workflow.id}`)
    if (isCurrentPathInThisFolder) {
      setIsOpen(true)
    }
  }, [pathname, workflows])

  if (workflows.length === 0) {
    return null
  }

  // Calculate height based on number of workflows, with a maximum of 4
  const navItemHeight = 32 // Height of each NavItem in pixels
  const gapSize = 12 // Gap between items (3 in rem units = ~12px)
  const maxItems = 4

  // Calculate height for a single item (no gaps)
  const singleItemHeight = navItemHeight

  // Calculate heights for different number of items
  const twoItemsHeight = navItemHeight * 2 + gapSize
  const threeItemsHeight = navItemHeight * 3 + gapSize * 2
  const fourItemsHeight = navItemHeight * 4 + gapSize * 3

  // Max height is always the height of 4 items
  const maxHeight = fourItemsHeight
  const needsScroll = workflows.length > maxItems

  // Get exact height based on number of workflows (up to 4)
  const getExactHeight = () => {
    switch (Math.min(workflows.length, maxItems)) {
      case 1:
        return singleItemHeight
      case 2:
        return twoItemsHeight
      case 3:
        return threeItemsHeight
      case 4:
        return fourItemsHeight
      default:
        return 'auto'
    }
  }

  return (
    <div className="flex flex-col items-center w-full">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsOpen(!isOpen)}
            className={`flex !h-9 !w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground md:h-8 md:w-8 ${
              isOpen ? 'bg-accent' : ''
            }`}
          >
            <Icon className="!h-5 !w-5" />
            <span className="sr-only">{title}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{title}</TooltipContent>
      </Tooltip>

      {isOpen && (
        <div className="mt-3 flex flex-col items-center w-full">
          <div
            className={`flex flex-col items-center w-full ${
              needsScroll ? 'overflow-y-auto [&::-webkit-scrollbar]:hidden' : ''
            }`}
            style={{
              height: workflows.length <= maxItems ? `${getExactHeight()}px` : `${maxHeight}px`,
              minHeight: workflows.length === 1 ? `${singleItemHeight}px` : undefined,
              maxHeight: `${maxHeight}px`,
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            }}
          >
            <ul className="flex flex-col items-center gap-3 w-full">
              {workflows.map((workflow) => (
                <li key={workflow.id} className="flex justify-center w-full h-8 flex-shrink-0">
                  <NavItem href={`/w/${workflow.id}`} label={workflow.name}>
                    <div
                      className="h-4 w-4 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor:
                          workflow.color ||
                          (workflow.marketplaceData?.status === 'temp' ? '#808080' : '#3972F6'),
                      }}
                    />
                  </NavItem>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
