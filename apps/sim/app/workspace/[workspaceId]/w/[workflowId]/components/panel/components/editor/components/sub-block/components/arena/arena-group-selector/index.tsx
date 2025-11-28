'use client'

import * as React from 'react'
import axios from 'axios'
import { Check, ChevronsUpDown } from 'lucide-react'
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
import { env } from '@/lib/env'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useSubBlockStore, useWorkflowRegistry } from '@/stores'

interface Group {
  id: string
  name: string
}

interface ArenaGroupSelectorProps {
  blockId: string
  subBlockId: string
  title: string
  layout?: 'full' | 'half'
  isPreview?: boolean
  subBlockValues?: Record<string, any>
  disabled?: boolean
}

export function ArenaGroupSelector({
  blockId,
  subBlockId,
  title,
  layout,
  isPreview = false,
  subBlockValues,
  disabled = false,
}: ArenaGroupSelectorProps) {
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId, true)

  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const values = useSubBlockStore((state) => state.workflowValues)
  const clientId = values?.[activeWorkflowId ?? '']?.[blockId]?.['task-client']?.clientId
  const projectId = values?.[activeWorkflowId ?? '']?.[blockId]?.['task-project']

  const previewValue = isPreview && subBlockValues ? subBlockValues[subBlockId]?.value : undefined
  const selectedValue = isPreview ? previewValue : storeValue

  const [groups, setGroups] = React.useState<Group[]>([])
  const [open, setOpen] = React.useState(false)

  // Fetch groups when clientId & projectId are available
  React.useEffect(() => {
    if (!clientId || !projectId) return

    const fetchGroups = async () => {
      try {
        setGroups([])
        const v2Token = await getArenaToken()
        const arenaBackendBaseUrl = env.NEXT_PUBLIC_ARENA_BACKEND_BASE_URL
        const url = `${arenaBackendBaseUrl}/sol/v1/tasks/epic?cid=${clientId}&pid=${projectId}`

        const response = await axios.get(url, {
          headers: {
            Authorisation: v2Token || '',
          },
        })

        const epics = response.data?.epics || []
        const formattedGroups = epics.map((epic: any) => ({
          id: epic.id,
          name: epic.name,
        }))

        setGroups(formattedGroups)
      } catch (error) {
        console.error('Error fetching groups:', error)
        setGroups([])
      }
    }

    fetchGroups()
    return () => {
      setGroups([])
      setStoreValue(null)
    }
  }, [clientId, projectId])

  const selectedLabel =
    groups.find((grp) => grp.id === selectedValue?.id)?.name || 'Select group...'

  const handleSelect = (group: Group) => {
    if (!isPreview && !disabled) {
      setStoreValue(group)
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
            id={`group-${subBlockId}`}
            className='w-full justify-between'
            disabled={disabled || !clientId || !projectId}
          >
            <span className='truncate'>{selectedLabel}</span>
            <ChevronsUpDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-full p-0'>
          <Command
            filter={(value, search) => {
              const group = groups.find((g) => g.id === value || g.name === value)
              if (!group) return 0

              return group.name.toLowerCase().includes(search.toLowerCase()) ||
                group.id.toLowerCase().includes(search.toLowerCase())
                ? 1
                : 0
            }}
          >
            <CommandInput placeholder='Search groups...' className='h-9' />
            <CommandList>
              <CommandEmpty>No groups found.</CommandEmpty>
              <CommandGroup>
                {groups.map((group) => (
                  <CommandItem
                    key={group.id}
                    value={group.id}
                    onSelect={() => handleSelect(group)}
                    className='max-w-full whitespace-normal break-words'
                  >
                    <span className='truncate'>{group.name}</span>
                    <Check
                      className={cn(
                        'ml-auto h-4 w-4',
                        selectedValue?.id === group.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
