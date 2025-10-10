'use client'

import React, { useState, useMemo } from 'react'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Settings2 } from 'lucide-react'

interface GroupedCheckboxListProps {
  blockId: string
  subBlockId: string
  title: string
  options: { label: string; id: string; group?: string }[]
  layout?: 'full' | 'half'
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
  layout = 'full',
  isPreview = false,
  subBlockValues,
  disabled = false,
  maxHeight = 400,
}: GroupedCheckboxListProps) {
  const [open, setOpen] = useState(false)
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)

  // Get preview value or use store value
  const previewValue = isPreview && subBlockValues ? subBlockValues[subBlockId]?.value : undefined
  const selectedValues = (isPreview ? previewValue : storeValue) as string[] || []

  // Group options by their group property
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
      return <span className="text-muted-foreground text-sm">None selected</span>
    }
    if (allSelected) {
      return <span className="text-sm">All selected</span>
    }
    return <span className="text-sm">{selectedValues.length} selected</span>
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal" disabled={disabled}>
          <span className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Configure PII Types
          </span>
          <SelectedCountDisplay />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-2xl max-h-[80vh] flex flex-col"
        onWheel={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>Select PII Types to Detect</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Choose which types of personally identifiable information to detect and block.
          </p>
        </DialogHeader>

        {/* Header with Select All and Clear */}
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="select-all"
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
              htmlFor="select-all"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              Select all entities
            </label>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={disabled || noneSelected}
          >
            Clear
          </Button>
        </div>

        {/* Scrollable grouped checkboxes */}
        <div
          className="flex-1 overflow-y-auto pr-4"
          onWheel={(e) => e.stopPropagation()}
          style={{ maxHeight: '60vh' }}
        >
          <div className="space-y-6">
            {Object.entries(groupedOptions).map(([groupName, groupOptions]) => (
              <div key={groupName}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {groupName}
                </h3>
                <div className="space-y-3">
                  {groupOptions.map((option) => (
                    <div key={option.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`${subBlockId}-${option.id}`}
                        checked={selectedValues.includes(option.id)}
                        onCheckedChange={() => handleToggle(option.id)}
                        disabled={disabled}
                      />
                      <label
                        htmlFor={`${subBlockId}-${option.id}`}
                        className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
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

