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
import { env } from '@/lib/env'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '../../../hooks/use-sub-block-value'

interface ArenaState {
  id: string
  name: string
}

interface ArenaStatesSelectorProps {
  blockId: string
  subBlockId: string
  title: string
  layout?: 'full' | 'half'
  isPreview?: boolean
  subBlockValues?: Record<string, any>
  disabled?: boolean
}

export function ArenaStatesSelector({
  blockId,
  subBlockId,
  title,
  layout,
  isPreview = false,
  subBlockValues,
  disabled = false,
}: ArenaStatesSelectorProps) {
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId, true)

  // Expecting array for multiselect
  const previewValue = isPreview && subBlockValues ? subBlockValues[subBlockId]?.value : undefined
  const selectedValues: string[] = isPreview
    ? previewValue || []
    : Array.isArray(storeValue)
      ? storeValue
      : storeValue
        ? storeValue.split(',') // fallback if stored as CSV
        : []

  const [states, setStates] = React.useState<ArenaState[]>([])
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    const fetchStates = async () => {
      setStates([])
      try {
        const v2Token = await getArenaToken()
        const arenaBackendBaseUrl = env.NEXT_PUBLIC_ARENA_BACKEND_BASE_URL

        const url = `${arenaBackendBaseUrl}/sol/v1/state-management/state`
        const response = await axios.get(url, {
          headers: {
            authorisation: v2Token || '',
          },
        })

        setStates(response.data || [])
      } catch (error) {
        console.error('Error fetching states:', error)
        setStates([])
      }
    }

    fetchStates()

    return () => {
      setStates([])
    }
  }, [])

  const handleSelect = (stateName: string) => {
    if (isPreview || disabled) return

    let newValues: string[]
    if (selectedValues.includes(stateName)) {
      newValues = selectedValues.filter((s) => s !== stateName)
    } else {
      newValues = [...selectedValues, stateName]
    }

    setStoreValue(newValues) // store as array (or newValues.join(",") if backend expects CSV)
  }

  const selectedLabel = selectedValues.length > 0 ? selectedValues.join(', ') : 'Select states...'

  return (
    <div className={cn('flex flex-col gap-2 pt-1', layout === 'half' ? 'max-w-md' : 'w-full')}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            role='combobox'
            aria-expanded={open}
            id={`state-${subBlockId}`}
            className={cn(
              comboboxVariants(),
              'flex h-auto min-h-[2.5rem] w-full items-start justify-between whitespace-normal break-words py-2 text-left'
            )}
            disabled={disabled}
          >
            <div className='flex-1 whitespace-normal break-words text-left'>{selectedLabel}</div>
            <ChevronsUpDown className='mt-1 ml-2 h-4 w-4 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-[var(--radix-popover-trigger-width)] rounded-[4px] p-0'>
          <Command
            filter={(value, search) => {
              const state = states.find((s) => s.id === value || s.name === value)
              if (!state) return 0

              return state.name.toLowerCase().includes(search.toLowerCase()) ||
                state.id.toLowerCase().includes(search.toLowerCase())
                ? 1
                : 0
            }}
          >
            <CommandInput placeholder='Search states...' className='h-9' />
            <CommandList>
              <CommandEmpty>No state found.</CommandEmpty>
              <CommandGroup>
                {states.map((state) => (
                  <CommandItem
                    key={state.id}
                    value={state.name}
                    onSelect={() => handleSelect(state.name)}
                  >
                    {state.name}
                    <Check
                      className={cn(
                        'ml-auto h-4 w-4',
                        selectedValues.includes(state.name) ? 'opacity-100' : 'opacity-0'
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
