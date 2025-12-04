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

interface Assignee {
  value: string
  label: string
}

interface ArenaAssigneeSelectorProps {
  blockId: string
  subBlockId: string
  title: string
  layout?: 'full' | 'half'
  isPreview?: boolean
  subBlockValues?: Record<string, any>
  disabled?: boolean
}

export function ArenaAssigneeSelector({
  blockId,
  subBlockId,
  title,
  layout,
  isPreview = false,
  subBlockValues,
  disabled = false,
}: ArenaAssigneeSelectorProps) {
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId, true)

  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const values = useSubBlockStore((state) => state.workflowValues)
  const isSearchTask = subBlockId === 'search-task-assignee'
  const isCreateTask = subBlockId === 'task-assignee'
  const clientKey = subBlockId === 'task-assignee' ? 'task-client' : 'search-task-client'
  const projectKey = subBlockId === 'task-assignee' ? 'task-project' : 'search-task-project'
  const clientId = values?.[activeWorkflowId ?? '']?.[blockId]?.[clientKey]?.clientId
  const projectValue = values?.[activeWorkflowId ?? '']?.[blockId]?.[projectKey]
  const projectId = typeof projectValue === 'string' ? projectValue : projectValue?.sysId

  const previewValue = isPreview && subBlockValues ? subBlockValues[subBlockId]?.value : undefined
  const selectedValue = isPreview ? previewValue : storeValue

  const [assignees, setAssignees] = React.useState<Assignee[]>([])
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)

  // Fetch assignees when clientId & projectId change
  React.useEffect(() => {
    if (!clientId || (isCreateTask && !projectId)) return

    const fetchAssignees = async () => {
      setLoading(true)
      try {
        setAssignees([])
        const v2Token = await getArenaToken()
        const arenaBackendBaseUrl = env.NEXT_PUBLIC_ARENA_BACKEND_BASE_URL

        let url = `${arenaBackendBaseUrl}/sol/v1/users/list?cId=${clientId}&pId=${projectId}`
        if (isSearchTask) {
          url = `${url}&allUsers=true&includeClientUsers=true`
        }
        const response = await axios.get(url, {
          headers: {
            Authorisation: v2Token || '',
          },
        })

        const users = response.data?.userList || []

        const formattedAssignees: Assignee[] = users.map((user: any) => ({
          value: user.sysId,
          label: user.name,
        }))

        setAssignees(formattedAssignees)
      } catch (error) {
        console.error('Error fetching assignees:', error)
        setAssignees([])
      } finally {
        setLoading(false)
      }
    }

    fetchAssignees()
  }, [clientId, projectId, subBlockId])

  const selectedLabel =
    (typeof selectedValue === 'object' ? selectedValue?.customDisplayValue : null) ||
    assignees.find(
      (a) => a.value === (typeof selectedValue === 'object' ? selectedValue?.value : selectedValue)
    )?.label ||
    'Select assignee...'

  const handleSelect = (assignee: Assignee) => {
    if (!isPreview && !disabled) {
      setStoreValue({ ...assignee, customDisplayValue: assignee.label })
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
            id={`assignee-${subBlockId}`}
            className={cn(
              comboboxVariants(),
              'relative w-full cursor-pointer items-center justify-between'
            )}
            disabled={disabled || loading || !clientId || (isCreateTask && !projectId)}
          >
            {loading ? 'Loading...' : selectedLabel}
            <ChevronsUpDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-[var(--radix-popover-trigger-width)] rounded-[4px] p-0'>
          <Command
            filter={(value, search) => {
              const assignee = assignees.find((a) => a.value === value)
              if (!assignee) return 0
              return assignee.label.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
            }}
          >
            <CommandInput placeholder='Search assignee...' className='h-9' />
            <CommandList>
              <CommandEmpty>{loading ? 'Loading...' : 'No assignees found.'}</CommandEmpty>
              <CommandGroup>
                {assignees.map((assignee) => {
                  const isSelected =
                    typeof selectedValue === 'object'
                      ? selectedValue?.value === assignee.value
                      : selectedValue === assignee.value
                  return (
                    <CommandItem
                      key={assignee.value}
                      value={assignee.value}
                      onSelect={() => handleSelect(assignee)}
                    >
                      {assignee.label}
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
