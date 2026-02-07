'use client'

import { useMemo } from 'react'
import { X } from 'lucide-react'
import { Badge, Combobox, type ComboboxOption } from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { useWorkflows } from '@/hooks/queries/workflows'

interface WorkflowSelectorProps {
  workspaceId: string
  selectedIds: string[]
  allWorkflows: boolean
  onChange: (ids: string[], allWorkflows: boolean) => void
  error?: string
}

/**
 * Multi-select workflow selector with "All Workflows" option.
 * Uses Combobox's built-in showAllOption for the "All Workflows" selection.
 * When allWorkflows is true, the array is empty and "All Workflows" is selected.
 */
export function WorkflowSelector({
  workspaceId,
  selectedIds,
  allWorkflows,
  onChange,
  error,
}: WorkflowSelectorProps) {
  const { data: workflows = [], isPending: isLoading } = useWorkflows(workspaceId, {
    syncRegistry: false,
  })

  const options: ComboboxOption[] = useMemo(() => {
    return workflows.map((w) => ({
      label: w.name,
      value: w.id,
    }))
  }, [workflows])

  /**
   * When allWorkflows is true, pass empty array so the "All" option is selected.
   * Otherwise, pass the selected workflow IDs.
   */
  const currentValues = useMemo(() => {
    return allWorkflows ? [] : selectedIds
  }, [allWorkflows, selectedIds])

  /**
   * Handle multi-select changes from Combobox.
   * Empty array from showAllOption = all workflows selected.
   */
  const handleMultiSelectChange = (values: string[]) => {
    if (values.length === 0) {
      onChange([], true)
    } else {
      onChange(values, false)
    }
  }

  const handleRemove = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    onChange(
      selectedIds.filter((i) => i !== id),
      false
    )
  }

  const selectedWorkflows = useMemo(() => {
    return workflows.filter((w) => selectedIds.includes(w.id))
  }, [workflows, selectedIds])

  const overlayContent = useMemo(() => {
    if (allWorkflows) {
      return <span className='truncate text-[var(--text-primary)]'>All Workflows</span>
    }

    if (selectedWorkflows.length === 0) {
      return null
    }

    return (
      <div className='flex items-center gap-[4px] overflow-hidden'>
        {selectedWorkflows.slice(0, 2).map((w) => (
          <Badge
            key={w.id}
            variant='outline'
            className='pointer-events-auto cursor-pointer gap-[4px] rounded-[6px] px-[8px] py-[2px] text-[11px]'
            onMouseDown={(e) => handleRemove(e, w.id)}
          >
            {w.name}
            <X className='!text-[var(--text-primary)] h-4 w-4 flex-shrink-0 opacity-50' />
          </Badge>
        ))}
        {selectedWorkflows.length > 2 && (
          <Badge variant='outline' className='rounded-[6px] px-[8px] py-[2px] text-[11px]'>
            +{selectedWorkflows.length - 2}
          </Badge>
        )}
      </div>
    )
  }, [allWorkflows, selectedWorkflows, selectedIds])

  if (isLoading) {
    return (
      <div className='flex flex-col gap-[4px]'>
        <span className='font-medium text-[13px] text-[var(--text-secondary)]'>Workflows</span>
        <Skeleton className='h-[34px] w-full rounded-[6px]' />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-[4px]'>
      <span className='font-medium text-[13px] text-[var(--text-secondary)]'>Workflows</span>
      <Combobox
        options={options}
        multiSelect
        multiSelectValues={currentValues}
        onMultiSelectChange={handleMultiSelectChange}
        placeholder='Select workflows...'
        error={error}
        overlayContent={overlayContent}
        searchable
        searchPlaceholder='Search workflows...'
        showAllOption
        allOptionLabel='All Workflows'
      />
    </div>
  )
}

export default WorkflowSelector
