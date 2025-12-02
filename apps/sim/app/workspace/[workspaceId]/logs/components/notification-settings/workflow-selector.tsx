'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent, PopoverScrollArea } from '@/components/emcn'
import { Label, Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'

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
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string }>>([])
  const [isLoading, setIsLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const filteredWorkflows = useMemo(() => {
    if (!search) return workflows
    const term = search.toLowerCase()
    return workflows.filter((w) => w.name.toLowerCase().includes(term))
  }, [workflows, search])

  const selectedWorkflows = useMemo(() => {
    return workflows.filter((w) => selectedIds.includes(w.id))
  }, [workflows, selectedIds])

  const handleSelect = useCallback(
    (id: string) => {
      if (selectedIds.includes(id)) {
        onChange(
          selectedIds.filter((i) => i !== id),
          false
        )
      } else {
        onChange([...selectedIds, id], false)
      }
    },
    [selectedIds, onChange]
  )

  const handleSelectAll = useCallback(() => {
    onChange([], !allWorkflows)
  }, [allWorkflows, onChange])

  const handleRemove = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault()
      e.stopPropagation()
      onChange(
        selectedIds.filter((i) => i !== id),
        false
      )
    },
    [selectedIds, onChange]
  )

  if (isLoading) {
    return (
      <div className='space-y-2'>
        <Label className='font-medium text-sm'>Workflows</Label>
        <Skeleton className='h-9 w-full rounded-[4px]' />
      </div>
    )
  }

  const hasSelection = allWorkflows || selectedWorkflows.length > 0

  return (
    <div className='space-y-2'>
      <Label className='font-medium text-sm'>Workflows</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div
            onClick={() => setOpen(true)}
            className={cn(
              'relative flex w-full cursor-text rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] dark:bg-[var(--surface-9)] hover:border-[var(--surface-14)] hover:bg-[var(--surface-9)] dark:hover:border-[var(--surface-13)] dark:hover:bg-[var(--surface-11)]',
              error && 'border-red-400'
            )}
          >
            <input
              ref={inputRef}
              type='text'
              placeholder={hasSelection && !open ? '' : 'Select workflows...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false)
                  inputRef.current?.blur()
                }
              }}
              className={cn(
                'flex-1 bg-transparent px-[8px] py-[6px] font-sans font-medium text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none',
                hasSelection && !open && 'text-transparent'
              )}
            />
            {hasSelection && !open && (
              <div className='pointer-events-none absolute inset-y-0 left-0 right-[28px] flex items-center gap-1 overflow-hidden px-[8px]'>
                {allWorkflows ? (
                  <span className='rounded-[4px] bg-[var(--surface-11)] px-2 py-0.5 text-xs'>
                    All Workflows
                  </span>
                ) : (
                  <>
                    {selectedWorkflows.slice(0, 2).map((w) => (
                      <span
                        key={w.id}
                        className='pointer-events-auto flex items-center gap-1 rounded-[4px] bg-[var(--surface-11)] px-2 py-0.5 text-xs'
                      >
                        {w.name}
                        <button
                          type='button'
                          onMouseDown={(e) => handleRemove(e, w.id)}
                          className='opacity-60 hover:opacity-100'
                        >
                          <X className='h-3 w-3' />
                        </button>
                      </span>
                    ))}
                    {selectedWorkflows.length > 2 && (
                      <span className='rounded-[4px] bg-[var(--surface-11)] px-2 py-0.5 text-xs'>
                        +{selectedWorkflows.length - 2}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
            <div
              className='flex cursor-pointer items-center px-[8px]'
              onClick={(e) => {
                e.stopPropagation()
                setOpen((prev) => !prev)
              }}
            >
              <ChevronDown
                className={cn('h-4 w-4 opacity-50 transition-transform', open && 'rotate-180')}
              />
            </div>
          </div>
        </PopoverAnchor>

        <PopoverContent
          side='bottom'
          align='start'
          sideOffset={4}
          maxHeight={280}
          className='w-[var(--radix-popover-trigger-width)] rounded-[4px] p-1'
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            inputRef.current?.focus()
          }}
        >
          <PopoverScrollArea>
            <div
              role='option'
              aria-selected={allWorkflows}
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelectAll()
              }}
              className={cn(
                'relative flex cursor-pointer select-none items-center rounded-[4px] px-[8px] py-[6px] font-sans text-sm hover:bg-[var(--surface-11)]',
                allWorkflows && 'bg-[var(--surface-11)]'
              )}
            >
              <span className='flex-1 text-[var(--text-primary)]'>All Workflows</span>
              <span className='mr-2 text-[var(--text-muted)] text-xs'>Includes future</span>
              {allWorkflows && <Check className='h-4 w-4 flex-shrink-0' />}
            </div>

            <div className='my-1 h-px bg-[var(--surface-11)]' />

            {filteredWorkflows.length === 0 ? (
              <div className='px-[8px] py-[6px] text-center text-[var(--text-muted)] text-sm'>
                {search ? 'No workflows found' : 'No workflows in workspace'}
              </div>
            ) : (
              filteredWorkflows.map((workflow) => {
                const isSelected = selectedIds.includes(workflow.id) || allWorkflows
                return (
                  <div
                    key={workflow.id}
                    role='option'
                    aria-selected={isSelected}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      if (!allWorkflows) handleSelect(workflow.id)
                    }}
                    className={cn(
                      'relative flex cursor-pointer select-none items-center rounded-[4px] px-[8px] py-[6px] font-sans text-sm hover:bg-[var(--surface-11)]',
                      isSelected && !allWorkflows && 'bg-[var(--surface-11)]',
                      allWorkflows && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    <span className='flex-1 truncate text-[var(--text-primary)]'>
                      {workflow.name}
                    </span>
                    {isSelected && <Check className='h-4 w-4 flex-shrink-0' />}
                  </div>
                )
              })
            )}
          </PopoverScrollArea>
        </PopoverContent>
      </Popover>
      {error && <p className='text-red-400 text-xs'>{error}</p>}
      <p className='text-muted-foreground text-xs'>
        Select which workflows should trigger this notification
      </p>
    </div>
  )
}
