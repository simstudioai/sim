'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Folder } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { NavItem } from '../nav-item/nav-item'

interface FolderSectionProps {
  title: string
  workflows: WorkflowMetadata[]
  defaultOpen?: boolean
}

export function FolderSection({ title, workflows, defaultOpen = true }: FolderSectionProps) {
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

  return (
    <div className="flex flex-col items-center">
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
            <Folder className="!h-5 !w-5" />
            <span className="sr-only">{title}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{title}</TooltipContent>
      </Tooltip>

      {isOpen && (
        <div className="mt-3 flex flex-col items-center gap-3">
          {workflows.map((workflow) => (
            <NavItem key={workflow.id} href={`/w/${workflow.id}`} label={workflow.name}>
              <div
                className="h-4 w-4 rounded-full"
                style={{
                  backgroundColor:
                    workflow.color ||
                    (workflow.marketplaceData?.status === 'temp' ? '#808080' : '#3972F6'),
                }}
              />
            </NavItem>
          ))}
        </div>
      )}
    </div>
  )
}
