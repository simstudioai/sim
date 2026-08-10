'use client'

import type React from 'react'
import { useRef, useState } from 'react'
import { SubBlockFieldHeader } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/field-header'
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
    <div key={paramId} className='relative min-w-0 space-y-1.5'>
      <SubBlockFieldHeader
        title={title}
        required={isRequired && visibility === 'user-only'}
        wandAction={
          showWand
            ? {
                isSearchActive,
                searchQuery,
                isStreaming,
                onSearchClick: handleSearchClick,
                onSearchBlur: handleSearchBlur,
                onSearchChange: handleSearchChange,
                onSearchSubmit: handleSearchSubmit,
                onSearchCancel: handleSearchCancel,
                searchInputRef,
              }
            : undefined
        }
        canonicalAction={
          canonicalToggle && !isPreview
            ? {
                ...canonicalToggle,
                disabled: canonicalToggle.disabled || disabled,
              }
            : undefined
        }
      />
      <div className='relative w-full min-w-0'>{children(wandControlRef)}</div>
    </div>
  )
}
