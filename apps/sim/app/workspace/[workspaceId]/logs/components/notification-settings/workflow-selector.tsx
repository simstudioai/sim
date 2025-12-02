'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { Button, Input, Label, Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'

interface Workflow {
  id: string
  name: string
}

interface WorkflowSelectorProps {
  workspaceId: string
  selectedIds: string[]
  allWorkflows: boolean
  onChange: (ids: string[], allWorkflows: boolean) => void
  error?: string
}

export function WorkflowSelector({
  workspaceId,
  selectedIds,
  allWorkflows,
  onChange,
  error,
}: WorkflowSelectorProps) {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const loadWorkflows = useCallback(async () => {
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
  }, [workspaceId])

  useEffect(() => {
    loadWorkflows()
  }, [loadWorkflows])

  const filteredWorkflows = useMemo(() => {
    if (!search) return workflows
    const term = search.toLowerCase()
    return workflows.filter((w) => w.name.toLowerCase().includes(term))
  }, [workflows, search])

  const selectedWorkflows = useMemo(() => {
    return workflows.filter((w) => selectedIds.includes(w.id))
  }, [workflows, selectedIds])

  const handleToggleWorkflow = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(
        selectedIds.filter((i) => i !== id),
        false
      )
    } else {
      onChange([...selectedIds, id], false)
    }
  }

  const handleToggleAll = () => {
    if (allWorkflows) {
      onChange([], false)
    } else {
      onChange([], true)
    }
  }

  const handleRemove = (id: string) => {
    onChange(
      selectedIds.filter((i) => i !== id),
      false
    )
  }

  if (isLoading) {
    return (
      <div className='space-y-2'>
        <Label className='font-medium text-sm'>Workflows</Label>
        <Skeleton className='h-9 w-full rounded-[8px]' />
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      <Label className='font-medium text-sm'>Workflows</Label>
      <div ref={containerRef} className='relative'>
        <Button
          type='button'
          variant='outline'
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            'h-auto min-h-9 w-full justify-between rounded-[8px] px-3 py-2 text-left font-normal',
            error && 'border-red-400'
          )}
        >
          <div className='flex flex-wrap gap-1'>
            {allWorkflows ? (
              <span className='rounded-md bg-muted px-2 py-0.5 text-xs'>All Workflows</span>
            ) : selectedWorkflows.length > 0 ? (
              selectedWorkflows.slice(0, 3).map((w) => (
                <span
                  key={w.id}
                  className='flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs'
                >
                  {w.name}
                  <button
                    type='button'
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemove(w.id)
                    }}
                    className='hover:text-foreground'
                  >
                    <X className='h-3 w-3' />
                  </button>
                </span>
              ))
            ) : (
              <span className='text-muted-foreground text-sm'>Select workflows...</span>
            )}
            {!allWorkflows && selectedWorkflows.length > 3 && (
              <span className='rounded-md bg-muted px-2 py-0.5 text-xs'>
                +{selectedWorkflows.length - 3} more
              </span>
            )}
          </div>
          <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
        </Button>

        {isOpen && (
          <div className='absolute z-50 mt-1 w-full rounded-[8px] border bg-popover p-2 shadow-md'>
            <div className='mb-2 flex items-center gap-2 rounded-md border bg-background px-2'>
              <Search className='h-4 w-4 text-muted-foreground' />
              <Input
                type='text'
                placeholder='Search workflows...'
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className='h-8 border-0 bg-transparent px-0 text-sm focus-visible:ring-0'
              />
            </div>

            <div className='max-h-[200px] overflow-y-auto'>
              <button
                type='button'
                onClick={handleToggleAll}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  allWorkflows
                    ? 'bg-[var(--brand-primary-hex)]/10 text-[var(--brand-primary-hex)]'
                    : 'hover:bg-muted'
                )}
              >
                <div
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded border',
                    allWorkflows
                      ? 'border-[var(--brand-primary-hex)] bg-[var(--brand-primary-hex)]'
                      : 'border-muted-foreground'
                  )}
                >
                  {allWorkflows && <Check className='h-3 w-3 text-white' />}
                </div>
                <span className='font-medium'>All Workflows</span>
                <span className='ml-auto text-muted-foreground text-xs'>
                  Includes future workflows
                </span>
              </button>

              <div className='my-2 h-px bg-border' />

              {filteredWorkflows.length === 0 ? (
                <div className='px-2 py-4 text-center text-muted-foreground text-sm'>
                  {search ? 'No workflows found' : 'No workflows in workspace'}
                </div>
              ) : (
                filteredWorkflows.map((workflow) => (
                  <button
                    key={workflow.id}
                    type='button'
                    onClick={() => handleToggleWorkflow(workflow.id)}
                    disabled={allWorkflows}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      selectedIds.includes(workflow.id) && !allWorkflows
                        ? 'bg-muted'
                        : 'hover:bg-muted',
                      allWorkflows && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded border',
                        selectedIds.includes(workflow.id) || allWorkflows
                          ? 'border-[var(--brand-primary-hex)] bg-[var(--brand-primary-hex)]'
                          : 'border-muted-foreground'
                      )}
                    >
                      {(selectedIds.includes(workflow.id) || allWorkflows) && (
                        <Check className='h-3 w-3 text-white' />
                      )}
                    </div>
                    <span className='truncate'>{workflow.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      {error && <p className='text-red-400 text-xs'>{error}</p>}
      <p className='text-muted-foreground text-xs'>
        Select which workflows should trigger this notification
      </p>
    </div>
  )
}
