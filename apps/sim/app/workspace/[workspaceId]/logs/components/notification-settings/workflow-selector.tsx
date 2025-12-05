'use client'

import { useEffect, useMemo, useState } from 'react'
import { Layers, X } from 'lucide-react'
import { Button, Combobox, type ComboboxOption } from '@/components/emcn'
import { Label, Skeleton } from '@/components/ui'

interface WorkflowSelectorProps {
  workspaceId: string
  selectedIds: string[]
  allWorkflows: boolean
  onChange: (ids: string[], allWorkflows: boolean) => void
  error?: string
}

const ALL_WORKFLOWS_VALUE = '__all_workflows__'

/**
 * Multi-select workflow selector with "All Workflows" option.
 */
export function WorkflowSelector({
  workspaceId,
  selectedIds,
  allWorkflows,
  onChange,
  error,
}: WorkflowSelectorProps) {
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string }>>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true)
        const response = await fetch(`/api/workflows?workspaceId=${workspaceId}`)
        if (response.ok) {
          const data = await response.json()
          setWorkflows(data.data || [])
        }
      } catch {
        setWorkflows([])
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [workspaceId])

  const options: ComboboxOption[] = useMemo(() => {
    const workflowOptions = workflows.map((w) => ({
      label: w.name,
      value: w.id,
    }))

    return [
      {
        label: 'All Workflows',
        value: ALL_WORKFLOWS_VALUE,
        icon: Layers,
      },
      ...workflowOptions,
    ]
  }, [workflows])

  const currentValues = useMemo(() => {
    if (allWorkflows) {
      return [ALL_WORKFLOWS_VALUE]
    }
    return selectedIds
  }, [allWorkflows, selectedIds])

  const handleMultiSelectChange = (values: string[]) => {
    const hasAllWorkflows = values.includes(ALL_WORKFLOWS_VALUE)
    const hadAllWorkflows = allWorkflows

    if (hasAllWorkflows && !hadAllWorkflows) {
      // User selected "All Workflows" - clear individual selections
      onChange([], true)
    } else if (!hasAllWorkflows && hadAllWorkflows) {
      // User deselected "All Workflows" - switch to individual selection
      onChange(
        values.filter((v) => v !== ALL_WORKFLOWS_VALUE),
        false
      )
    } else {
      // Normal individual workflow selection/deselection
      onChange(
        values.filter((v) => v !== ALL_WORKFLOWS_VALUE),
        false
      )
    }
  }

  const handleRemove = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (id === ALL_WORKFLOWS_VALUE) {
      onChange([], false)
    } else {
      onChange(
        selectedIds.filter((i) => i !== id),
        false
      )
    }
  }

  const selectedWorkflows = useMemo(() => {
    return workflows.filter((w) => selectedIds.includes(w.id))
  }, [workflows, selectedIds])

  // Render overlay content showing selected items as tags
  const overlayContent = useMemo(() => {
    if (allWorkflows) {
      return (
        <div className='flex items-center gap-1'>
          <Button
            variant='outline'
            className='pointer-events-auto h-6 gap-1 rounded-[6px] px-2 text-[11px]'
            onMouseDown={(e) => handleRemove(e, ALL_WORKFLOWS_VALUE)}
          >
            <Layers className='h-3 w-3' />
            All Workflows
            <X className='h-3 w-3' />
          </Button>
        </div>
      )
    }

    if (selectedWorkflows.length === 0) {
      return null
    }

    return (
      <div className='flex items-center gap-1 overflow-hidden'>
        {selectedWorkflows.slice(0, 2).map((w) => (
          <Button
            key={w.id}
            variant='outline'
            className='pointer-events-auto h-6 gap-1 rounded-[6px] px-2 text-[11px]'
            onMouseDown={(e) => handleRemove(e, w.id)}
          >
            {w.name}
            <X className='h-3 w-3' />
          </Button>
        ))}
        {selectedWorkflows.length > 2 && (
          <span className='flex h-6 items-center rounded-[6px] border px-2 text-[11px]'>
            +{selectedWorkflows.length - 2}
          </span>
        )}
      </div>
    )
  }, [allWorkflows, selectedWorkflows, selectedIds])

  if (isLoading) {
    return (
      <div className='space-y-2'>
        <Label className='font-medium text-sm'>Workflows</Label>
        <Skeleton className='h-9 w-full rounded-[4px]' />
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      <Label className='font-medium text-sm'>Workflows</Label>
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
      />
      <p className='text-muted-foreground text-xs'>
        Select which workflows should trigger this notification
      </p>
    </div>
  )
}
