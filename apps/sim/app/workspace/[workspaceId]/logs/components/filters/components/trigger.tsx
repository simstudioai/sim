import { useMemo, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/emcn'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getTriggerOptions } from '@/lib/logs/get-trigger-options'
import {
  commandListClass,
  dropdownContentClass,
  filterButtonClass,
  triggerDropdownListStyle,
} from '@/app/workspace/[workspaceId]/logs/components/filters/components/shared'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { TriggerType } from '@/stores/logs/filters/types'

export default function Trigger() {
  const { triggers, toggleTrigger, setTriggers } = useFilterStore()
  const [search, setSearch] = useState('')

  const triggerOptions = useMemo(() => getTriggerOptions(), [])

  const getSelectedTriggersText = () => {
    if (triggers.length === 0) return 'All triggers'
    if (triggers.length === 1) {
      const selected = triggerOptions.find((t) => t.value === triggers[0])
      return selected ? selected.label : 'All triggers'
    }
    return `${triggers.length} triggers selected`
  }

  const isTriggerSelected = (trigger: TriggerType) => {
    return triggers.includes(trigger)
  }

  const clearSelections = () => {
    setTriggers([])
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' className={filterButtonClass}>
          {getSelectedTriggersText()}
          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        avoidCollisions={false}
        sideOffset={4}
        className={dropdownContentClass}
      >
        <Command>
          <CommandInput placeholder='Search triggers...' onValueChange={(v) => setSearch(v)} />
          <CommandList className={commandListClass} style={triggerDropdownListStyle}>
            <CommandEmpty>No triggers found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value='all-triggers'
                onSelect={() => clearSelections()}
                className='cursor-pointer'
              >
                <span>All triggers</span>
                {triggers.length === 0 && (
                  <Check className='ml-auto h-4 w-4 text-muted-foreground' />
                )}
              </CommandItem>
              {useMemo(() => {
                const q = search.trim().toLowerCase()
                const filtered = q
                  ? triggerOptions.filter((t) => t.label.toLowerCase().includes(q))
                  : triggerOptions
                return filtered.map((triggerItem) => (
                  <CommandItem
                    key={triggerItem.value}
                    value={triggerItem.label}
                    onSelect={() => toggleTrigger(triggerItem.value)}
                    className='cursor-pointer'
                  >
                    <div className='flex items-center'>
                      {triggerItem.color && (
                        <div
                          className='mr-2 h-2 w-2 rounded-full'
                          style={{ backgroundColor: triggerItem.color }}
                        />
                      )}
                      {triggerItem.label}
                    </div>
                    {isTriggerSelected(triggerItem.value) && (
                      <Check className='ml-auto h-4 w-4 text-muted-foreground' />
                    )}
                  </CommandItem>
                ))
              }, [search, triggers])}
            </CommandGroup>
          </CommandList>
        </Command>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
