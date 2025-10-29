import { useMemo, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'

interface MultiSelectDropdownProps {
  blockId: string
  subBlockId: string
  options?:
    | Array<string | { label: string; id: string }>
    | (() => Array<string | { label: string; id: string }>)
  placeholder?: string
  value?: string[]
  isPreview?: boolean
  previewValue?: string[] | null
  disabled?: boolean
  config?: import('@/blocks/types').SubBlockConfig
}

export function MultiSelectDropdown({
  blockId,
  subBlockId,
  options: propOptions,
  placeholder = 'Select options...',
  value: propValue,
  isPreview = false,
  previewValue,
  disabled = false,
  config,
}: MultiSelectDropdownProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string[]>(blockId, subBlockId)
  const [open, setOpen] = useState(false)

  // Use preview value when in preview mode, otherwise use store value or prop value
  const selectedValues = isPreview
    ? previewValue || []
    : propValue !== undefined
      ? propValue
      : storeValue || []

  // Evaluate options if it's a function and normalize to {label, id} format
  const availableOptions = useMemo(() => {
    const rawOptions = typeof propOptions === 'function' ? propOptions() : propOptions || []
    return rawOptions.map((opt) => {
      if (typeof opt === 'string') {
        return { id: opt, label: opt }
      }
      return opt
    })
  }, [propOptions])

  // Create a map for quick lookup of display names
  const optionMap = useMemo(() => {
    return new Map(availableOptions.map((opt) => [opt.id, opt.label]))
  }, [availableOptions])

  const handleToggleOption = (optionId: string) => {
    if (!isPreview && !disabled) {
      const newValues = selectedValues.includes(optionId)
        ? selectedValues.filter((v) => v !== optionId)
        : [...selectedValues, optionId]
      setStoreValue(newValues)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          role='combobox'
          aria-expanded={open}
          disabled={disabled}
          className='h-9 w-full justify-between rounded-[8px] text-left font-normal'
        >
          <div className='flex w-full items-center justify-between'>
            {selectedValues.length > 0 ? (
              <div className='flex flex-wrap gap-1'>
                {selectedValues.slice(0, 2).map((selectedValue: string) => (
                  <Badge key={selectedValue} variant='secondary' className='text-xs'>
                    {optionMap.get(selectedValue) || selectedValue}
                  </Badge>
                ))}
                {selectedValues.length > 2 && (
                  <Badge variant='secondary' className='text-xs'>
                    +{selectedValues.length - 2} more
                  </Badge>
                )}
              </div>
            ) : (
              <span className='text-muted-foreground'>{placeholder}</span>
            )}
            <ChevronDown className='ml-2 h-4 w-4 flex-shrink-0 opacity-50' />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[400px] p-0' align='start'>
        <Command className='outline-none focus:outline-none'>
          <CommandInput
            placeholder='Search options...'
            className='text-foreground placeholder:text-muted-foreground'
          />
          <CommandList
            className='max-h-[200px] overflow-y-auto outline-none focus:outline-none'
            onWheel={(e) => e.stopPropagation()}
          >
            <CommandEmpty>
              {availableOptions.length === 0 ? 'No options available.' : 'No options found.'}
            </CommandEmpty>
            <CommandGroup>
              {availableOptions.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  onSelect={() => handleToggleOption(option.id)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      selectedValues.includes(option.id) ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
