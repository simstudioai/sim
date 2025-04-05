'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Folder, LucideIcon, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { NavItem } from '../nav-item/nav-item'

interface WorkflowFolderProps {
  title: string
  workflows: WorkflowMetadata[]
  defaultOpen?: boolean
  icon?: LucideIcon
  maxItems?: number
  hasMarketplace?: boolean
}

interface WorkflowFoldersProps {
  regularWorkflows: WorkflowMetadata[]
  marketplaceWorkflows: WorkflowMetadata[]
}

/**
 * WorkflowFolder component for rendering a collapsible group of workflows
 */
function WorkflowFolder({
  title,
  workflows,
  defaultOpen = true,
  icon: Icon = Folder,
  maxItems,
  hasMarketplace = false,
}: WorkflowFolderProps) {
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

  // Filter workflows if maxItems is specified
  const displayedWorkflows = maxItems ? workflows.slice(0, maxItems) : workflows

  return (
    <div className="flex flex-col items-center w-full">
      {/* Folder Button - This stays fixed */}
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

      {/* Workflow items with separate scrollable container */}
      {isOpen && (
        <div className="mt-3 w-full flex items-center flex-col">
          <div
            className={`w-full flex flex-col items-center gap-3 ${hasMarketplace ? 'max-h-[calc(240px+0.5rem)] overflow-y-auto pb-2 scrollbar-none' : ''}`}
          >
            {displayedWorkflows.map((workflow) => (
              <li key={workflow.id} className="flex justify-center w-full h-8 flex-shrink-0">
                <NavItem key={workflow.id} href={`/w/${workflow.id}`} label={workflow.name}>
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
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * WorkflowFolders - main component for sidebar workflow organization
 * Handles both regular and marketplace workflows in a single unified component
 */
export function WorkflowFolders({ regularWorkflows, marketplaceWorkflows }: WorkflowFoldersProps) {
  const hasMarketplace = marketplaceWorkflows.length > 0

  // Limit regular workflows to 7 when marketplace workflows exist
  const maxRegularWorkflows = hasMarketplace ? 7 : undefined

  return (
    <div className="flex flex-col w-full space-y-6">
      {/* Regular Workflows Section */}
      <div>
        <WorkflowFolder
          title="My Workflows"
          workflows={regularWorkflows}
          defaultOpen={true}
          maxItems={maxRegularWorkflows}
          hasMarketplace={hasMarketplace}
        />
      </div>

      {/* Marketplace Workflows Section - Only when marketplace workflows exist */}
      {hasMarketplace && (
        <div>
          <WorkflowFolder
            title="Marketplace"
            workflows={marketplaceWorkflows}
            defaultOpen={true}
            icon={Store}
            hasMarketplace={true}
          />
        </div>
      )}
    </div>
  )
}
