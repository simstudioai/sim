'use client'

import type React from 'react'
import { useRef, useState } from 'react'
import { ArrowLeftRight, ArrowUp } from 'lucide-react'
import { Button, Input, Label, Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { WandControlHandlers } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block'

/**
 * Props for a generic parameter with label component
 */
export interface ParameterWithLabelProps {
  paramId: string
  title: string
  isRequired: boolean
  visibility: string
  wandConfig?: {
    enabled: boolean
    prompt?: string
    placeholder?: string
  }
  canonicalToggle?: {
    mode: 'basic' | 'advanced'
    disabled?: boolean
    onToggle?: () => void
  }
  disabled: boolean
  isPreview: boolean
  children: (wandControlRef: React.MutableRefObject<WandControlHandlers | null>) => React.ReactNode
}

/**
 * Generic wrapper component for parameters that manages wand state and renders label + input
 */
export function ParameterWithLabel({
  paramId,
  title,
  isRequired,
  visibility,
  wandConfig,
  canonicalToggle,
  disabled,
  isPreview,
  children,
}: ParameterWithLabelProps) {
  const [isSearchActive, setIsSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const wandControlRef = useRef<WandControlHandlers | null>(null)

  const isWandEnabled = wandConfig?.enabled ?? false
  const showWand = isWandEnabled && !isPreview && !disabled

  const handleSearchClick = (): void => {
    setIsSearchActive(true)
    setTimeout(() => {
      searchInputRef.current?.focus()
    }, 0)
  }

  const handleSearchBlur = (): void => {
    if (!searchQuery.trim() && !wandControlRef.current?.isWandStreaming) {
      setIsSearchActive(false)
    }
  }

  const handleSearchChange = (value: string): void => {
    setSearchQuery(value)
  }

  const handleSearchSubmit = (): void => {
    if (searchQuery.trim() && wandControlRef.current) {
      wandControlRef.current.onWandTrigger(searchQuery)
      setSearchQuery('')
      setIsSearchActive(false)
    }
  }

  const handleSearchCancel = (): void => {
    setSearchQuery('')
    setIsSearchActive(false)
  }

  const isStreaming = wandControlRef.current?.isWandStreaming ?? false

  return (
    <div key={paramId} className='relative min-w-0 space-y-[6px]'>
      <div className='flex items-center justify-between gap-[6px] pl-[2px]'>
        <Label className='flex items-center gap-[6px] whitespace-nowrap font-medium text-[13px] text-[var(--text-primary)]'>
          {title}
          {isRequired && visibility === 'user-only' && <span className='ml-0.5'>*</span>}
          {visibility !== 'user-only' && (
            <span className='-ml-[3px] text-[12px] font-normal text-[var(--text-tertiary)]'>
              (optional)
            </span>
          )}
        </Label>
        <div className='flex min-w-0 flex-1 items-center justify-end gap-[6px]'>
          {showWand &&
            (!isSearchActive ? (
              <Button
                variant='active'
                className='-my-1 h-5 px-2 py-0 text-[11px]'
                onClick={handleSearchClick}
              >
                Generate
              </Button>
            ) : (
              <div className='-my-1 flex min-w-[120px] max-w-[280px] flex-1 items-center gap-[4px]'>
                <Input
                  ref={searchInputRef}
                  value={isStreaming ? 'Generating...' : searchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    handleSearchChange(e.target.value)
                  }
                  onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
                    const relatedTarget = e.relatedTarget as HTMLElement | null
                    if (relatedTarget?.closest('button')) return
                    handleSearchBlur()
                  }}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter' && searchQuery.trim() && !isStreaming) {
                      handleSearchSubmit()
                    } else if (e.key === 'Escape') {
                      handleSearchCancel()
                    }
                  }}
                  disabled={isStreaming}
                  className={cn(
                    'h-5 min-w-[80px] flex-1 text-[11px]',
                    isStreaming && 'text-muted-foreground'
                  )}
                  placeholder='Generate with AI...'
                />
                <Button
                  variant='tertiary'
                  disabled={!searchQuery.trim() || isStreaming}
                  onMouseDown={(e: React.MouseEvent) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation()
                    handleSearchSubmit()
                  }}
                  className='h-[20px] w-[20px] flex-shrink-0 p-0'
                >
                  <ArrowUp className='h-[12px] w-[12px]' />
                </Button>
              </div>
            ))}
          {canonicalToggle && !isPreview && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  type='button'
                  className='flex h-[12px] w-[12px] flex-shrink-0 items-center justify-center bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-50'
                  onClick={canonicalToggle.onToggle}
                  disabled={canonicalToggle.disabled || disabled}
                  aria-label={
                    canonicalToggle.mode === 'advanced'
                      ? 'Switch to selector'
                      : 'Switch to manual ID'
                  }
                >
                  <ArrowLeftRight
                    className={cn(
                      '!h-[12px] !w-[12px]',
                      canonicalToggle.mode === 'advanced'
                        ? 'text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)]'
                    )}
                  />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>
                <p>
                  {canonicalToggle.mode === 'advanced'
                    ? 'Switch to selector'
                    : 'Switch to manual ID'}
                </p>
              </Tooltip.Content>
            </Tooltip.Root>
          )}
        </div>
      </div>
      <div className='relative w-full min-w-0'>{children(wandControlRef)}</div>
    </div>
  )
}
