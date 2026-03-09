'use client'

import { useMemo, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { Button, Checkbox } from '@/components/emcn/components'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/core/utils/cn'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'

interface GroupedCheckboxListProps {
  blockId: string
  subBlockId: string
  title: string
  options: { label: string; id: string; group?: string }[]
  isPreview?: boolean
  subBlockValues: Record<string, any>
  disabled?: boolean
  maxHeight?: number
}

export function GroupedCheckboxList({
  blockId,
  subBlockId,
  title,
  options,
  isPreview = false,
  subBlockValues,
  disabled = false,
  maxHeight = 400,
}: GroupedCheckboxListProps) {
  const [open, setOpen] = useState(false)
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)

  const previewValue = isPreview && subBlockValues ? subBlockValues[subBlockId]?.value : undefined
  const selectedValues = ((isPreview ? previewValue : storeValue) as string[]) || []

  const groupedOptions = useMemo(() => {
    const groups: Record<string, { label: string; id: string }[]> = {}

    options.forEach((option) => {
      const groupName = option.group || 'Other'
      if (!groups[groupName]) {
        groups[groupName] = []
      }
      groups[groupName].push({ label: option.label, id: option.id })
    })

    return groups
  }, [options])

  const handleToggle = (optionId: string) => {
    if (isPreview || disabled) return

    const currentValues = (selectedValues || []) as string[]
    const newValues = currentValues.includes(optionId)
      ? currentValues.filter((id) => id !== optionId)
      : [...currentValues, optionId]

    setStoreValue(newValues)
  }

  const handleSelectAll = () => {
    if (isPreview || disabled) return
    const allIds = options.map((opt) => opt.id)
    setStoreValue(allIds)
  }

  const handleClear = () => {
    if (isPreview || disabled) return
    setStoreValue([])
  }

  const allSelected = selectedValues.length === options.length
  const noneSelected = selectedValues.length === 0

  const SelectedCountDisplay = () => {
    if (noneSelected) {
      return (
        <span className='truncate font-medium text-[var(--text-muted)] text-sm'>None selected</span>
      )
    }
    if (allSelected) {
      return (
        <span className='truncate font-medium text-[var(--text-primary)] text-sm'>
          All selected
        </span>
      )
    }
    return (
      <span className='truncate font-medium text-[var(--text-primary)] text-sm'>
        {selectedValues.length} selected
      </span>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant='ghost'
          disabled={disabled}
          className={cn(
            'flex w-full cursor-pointer items-center justify-between rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[8px] py-[6px] font-medium font-sans text-[var(--text-primary)] text-sm outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-[var(--surface-5)]',
            'hover:border-[var(--surface-7)] hover:bg-[var(--surface-5)] dark:hover:border-[var(--surface-7)] dark:hover:bg-[var(--border-1)]'
          )}
        >
          <span className='flex flex-1 items-center gap-2 truncate text-[var(--text-muted)]'>
            <Settings2 className='h-4 w-4 flex-shrink-0 opacity-50' />
            <span className='truncate'>Configure PII Types</span>
          </span>
          <SelectedCountDisplay />
        </Button>
      </DialogTrigger>
      <DialogContent
        className='flex max-h-[80vh] max-w-2xl flex-col'
        onWheel={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>Select PII Types to Detect</DialogTitle>
          <p className='text-muted-foreground text-sm'>
            Choose which types of personally identifiable information to detect and block.
          </p>
        </DialogHeader>

        {/* Header with Select All and Clear */}
        <div className='flex items-center justify-between border-b pb-3'>
          <div className='flex items-center gap-2'>
            <Checkbox
              id='select-all'
              checked={allSelected}
              onCheckedChange={(checked) => {
                if (checked) {
                  handleSelectAll()
                } else {
                  handleClear()
                }
              }}
              disabled={disabled}
            />
            <label
              htmlFor='select-all'
              className='cursor-pointer font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
            >
              Select all entities
            </label>
          </div>
          <Button variant='ghost' onClick={handleClear} disabled={disabled || noneSelected}>
            <span className='flex items-center gap-1'>
              Clear{!noneSelected && <span>({selectedValues.length})</span>}
            </span>
          </Button>
        </div>

        {/* Scrollable grouped checkboxes */}
        <div
          className='flex-1 overflow-y-auto pr-4'
          onWheel={(e) => e.stopPropagation()}
          style={{ maxHeight: '60vh' }}
        >
          <div className='space-y-6'>
            {Object.entries(groupedOptions).map(([groupName, groupOptions]) => (
              <div key={groupName}>
                <h3 className='mb-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider'>
                  {groupName}
                </h3>
                <div className='space-y-3'>
                  {groupOptions.map((option) => (
                    <div key={option.id} className='flex items-center gap-2'>
                      <Checkbox
                        id={`${subBlockId}-${option.id}`}
                        checked={selectedValues.includes(option.id)}
                        onCheckedChange={() => handleToggle(option.id)}
                        disabled={disabled}
                      />
                      <label
                        htmlFor={`${subBlockId}-${option.id}`}
                        className='cursor-pointer text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
                      >
                        {option.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
