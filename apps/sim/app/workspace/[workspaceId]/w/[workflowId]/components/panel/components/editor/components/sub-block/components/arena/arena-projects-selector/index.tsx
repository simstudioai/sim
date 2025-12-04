'use client'

import * as React from 'react'
import axios from 'axios'
import { Check, ChevronsUpDown } from 'lucide-react'
import { comboboxVariants } from '@/components/emcn/components/combobox/combobox'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getArenaToken } from '@/lib/arena-utils/cookie-utils'
import { env } from '@/lib/core/config/env'
import { cn } from '@/lib/core/utils/cn'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useSubBlockStore, useWorkflowRegistry } from '@/stores'

interface Project {
  sysId: string
  name: string
}

interface ArenaProjectSelectorProps {
  blockId: string
  subBlockId: string
  title: string
  clientId?: string // <-- IMPORTANT: We need clientId to fetch projects
  layout?: 'full' | 'half'
  isPreview?: boolean
  subBlockValues?: Record<string, any>
  disabled?: boolean
}

export function ArenaProjectSelector({
  blockId,
  subBlockId,
  title,
  layout,
  isPreview = false,
  subBlockValues,
  disabled = false,
}: ArenaProjectSelectorProps) {
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId, true)

  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const values = useSubBlockStore((state) => state.workflowValues)
  const clientKey = subBlockId === 'task-project' ? 'task-client' : 'search-task-client'
  const clientId = values?.[activeWorkflowId ?? '']?.[blockId]?.[clientKey]?.clientId

  const previewValue = isPreview && subBlockValues ? subBlockValues[subBlockId]?.value : undefined
  const selectedValue = isPreview ? previewValue : storeValue

  const [projects, setProjects] = React.useState<Project[]>([])
  const [open, setOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')

  React.useEffect(() => {
    if (!clientId) return // No clientId, don't fetch projects

    const fetchProjects = async () => {
      setProjects([])
      try {
        const v2Token = await getArenaToken()

        const arenaBackendBaseUrl = env.NEXT_PUBLIC_ARENA_BACKEND_BASE_URL
        const url = `${arenaBackendBaseUrl}/sol/v1/projects?clientId=${clientId}&projectType=STATUS&name=${''}`
        const response = await axios.get(url, {
          headers: {
            Authorisation: v2Token || '',
          },
        })

        setProjects(response.data.projectList || [])
      } catch (error) {
        console.error('Error fetching projects:', error)
        setProjects([])
      }
    }

    fetchProjects()

    return () => {
      setProjects([])
    }
  }, [clientId, searchQuery])

  const selectedLabel =
    selectedValue?.customDisplayValue ||
    projects.find(
      (proj) =>
        proj.sysId === (typeof selectedValue === 'string' ? selectedValue : selectedValue?.sysId)
    )?.name ||
    'Select project...'

  const handleSelect = (project: Project) => {
    if (!isPreview && !disabled) {
      setStoreValue({ ...project, customDisplayValue: project.name })
      setOpen(false)
    }
  }

  return (
    <div className={cn('flex w-full flex-col gap-2 pt-1')}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            role='combobox'
            aria-expanded={open}
            id={`project-${subBlockId}`}
            className={cn(
              comboboxVariants(),
              'relative w-full cursor-pointer items-center justify-between'
            )}
            disabled={disabled || !clientId} // Disable if no client selected
          >
            <span className='block flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left'>
              {selectedLabel}
            </span>
            <ChevronsUpDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-[var(--radix-popover-trigger-width)] rounded-[4px] p-0'>
          <Command
            filter={(value, search) => {
              const project = projects.find((p) => p.sysId === value)
              if (!project) return 0
              return project.name.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
            }}
          >
            <CommandInput placeholder='Search projects...' className='h-9' />
            <CommandList>
              <CommandEmpty>No project found.</CommandEmpty>
              <CommandGroup>
                {projects.map((project) => {
                  const isSelected =
                    typeof selectedValue === 'string'
                      ? selectedValue === project.sysId
                      : selectedValue?.sysId === project.sysId
                  return (
                    <CommandItem
                      key={project.sysId}
                      value={project.sysId}
                      onSelect={() => handleSelect(project)}
                      className='whitespace-normal break-words'
                    >
                      <span className='flex-1 whitespace-normal break-words'>{project.name}</span>
                      <Check
                        className={cn('ml-auto h-4 w-4', isSelected ? 'opacity-100' : 'opacity-0')}
                      />
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
