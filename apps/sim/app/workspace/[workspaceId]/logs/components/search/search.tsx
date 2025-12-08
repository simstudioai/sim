'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button, Popover, PopoverAnchor, PopoverContent } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { createLogger } from '@/lib/logs/console/logger'
import { getIntegrationMetadata } from '@/lib/logs/get-trigger-options'
import { type ParsedFilter, parseQuery } from '@/lib/logs/query-parser'
import {
  type FolderData,
  SearchSuggestions,
  type TriggerData,
  type WorkflowData,
} from '@/lib/logs/search-suggestions'
import { useSearchState } from '@/app/workspace/[workspaceId]/logs/hooks/use-search-state'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('AutocompleteSearch')

interface AutocompleteSearchProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  onOpenChange?: (open: boolean) => void
}

export function AutocompleteSearch({
  value,
  onChange,
  placeholder = 'Search',
  className,
  onOpenChange,
}: AutocompleteSearchProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const workflows = useWorkflowRegistry((state) => state.workflows)
  const folders = useFolderStore((state) => state.folders)
  const [triggersData, setTriggersData] = useState<TriggerData[]>([])

  const workflowsData = useMemo<WorkflowData[]>(() => {
    return Object.values(workflows).map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
    }))
  }, [workflows])

  const foldersData = useMemo<FolderData[]>(() => {
    return Object.values(folders).map((f) => ({
      id: f.id,
      name: f.name,
    }))
  }, [folders])

  useEffect(() => {
    if (!workspaceId) return

    const fetchTriggers = async () => {
      try {
        const response = await fetch(`/api/logs/triggers?workspaceId=${workspaceId}`)
        if (!response.ok) return

        const data = await response.json()
        const triggers: TriggerData[] = data.triggers.map((trigger: string) => {
          const metadata = getIntegrationMetadata(trigger)
          return {
            value: trigger,
            label: metadata.label,
            color: metadata.color,
          }
        })

        setTriggersData(triggers)
      } catch (error) {
        logger.error('Failed to fetch triggers:', error)
      }
    }

    fetchTriggers()
  }, [workspaceId])

  const suggestionEngine = useMemo(() => {
    return new SearchSuggestions(workflowsData, foldersData, triggersData)
  }, [workflowsData, foldersData, triggersData])

  const handleFiltersChange = (filters: ParsedFilter[], textSearch: string) => {
    const filterStrings = filters.map(
      (f) => `${f.field}:${f.operator !== '=' ? f.operator : ''}${f.originalValue}`
    )
    const fullQuery = [...filterStrings, textSearch].filter(Boolean).join(' ')
    onChange(fullQuery)
  }

  const {
    appliedFilters,
    currentInput,
    textSearch,
    isOpen,
    suggestions,
    sections,
    highlightedIndex,
    highlightedBadgeIndex,
    inputRef,
    dropdownRef,
    handleInputChange,
    handleSuggestionSelect,
    handleKeyDown,
    handleFocus,
    handleBlur,
    removeBadge,
    clearAll,
    setHighlightedIndex,
    initializeFromQuery,
  } = useSearchState({
    onFiltersChange: handleFiltersChange,
    getSuggestions: (input) => suggestionEngine.getSuggestions(input),
  })

  const lastExternalValue = useRef(value)
  useEffect(() => {
    // Only re-initialize if value changed externally (not from user typing)
    if (value !== lastExternalValue.current) {
      lastExternalValue.current = value
      const parsed = parseQuery(value)
      initializeFromQuery(parsed.textSearch, parsed.filters)
    }
  }, [value, initializeFromQuery])

  // Initial sync on mount
  useEffect(() => {
    if (value) {
      const parsed = parseQuery(value)
      initializeFromQuery(parsed.textSearch, parsed.filters)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [dropdownWidth, setDropdownWidth] = useState(400)
  useEffect(() => {
    const measure = () => {
      if (inputRef.current) {
        setDropdownWidth(inputRef.current.parentElement?.offsetWidth || 400)
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    onOpenChange?.(isOpen)
  }, [isOpen, onOpenChange])

  useEffect(() => {
    if (!isOpen || highlightedIndex < 0) return
    const container = dropdownRef.current
    const optionEl = container?.querySelector(`[data-index="${highlightedIndex}"]`)
    if (container && optionEl) {
      optionEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [isOpen, highlightedIndex])

  const hasFilters = appliedFilters.length > 0
  const hasTextSearch = textSearch.length > 0
  const suggestionType =
    sections.length > 0 ? 'multi-section' : suggestions.length > 0 ? suggestions[0]?.category : null

  return (
    <div className={cn('relative', className)}>
      {/* Search Input with Inline Badges */}
      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setHighlightedIndex(-1)
          }
        }}
      >
        <PopoverAnchor asChild>
          <div className='relative flex h-[32px] w-[400px] items-center rounded-[8px] bg-[var(--surface-5)]'>
            {/* Search Icon */}
            <Search className='mr-[6px] ml-[8px] h-[14px] w-[14px] flex-shrink-0 text-[var(--text-subtle)]' />

            {/* Scrollable container for badges */}
            <div className='flex flex-1 items-center gap-[6px] overflow-x-auto pr-[6px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
              {/* Applied Filter Badges */}
              {appliedFilters.map((filter, index) => (
                <Button
                  key={`${filter.field}-${filter.value}-${index}`}
                  variant='outline'
                  className={cn(
                    'h-6 flex-shrink-0 gap-1 rounded-[6px] px-2 text-[11px]',
                    highlightedBadgeIndex === index && 'border'
                  )}
                  onClick={(e) => {
                    e.preventDefault()
                    removeBadge(index)
                  }}
                >
                  <span className='text-[var(--text-muted)]'>{filter.field}:</span>
                  <span className='text-[var(--text-primary)]'>
                    {filter.operator !== '=' && filter.operator}
                    {filter.originalValue}
                  </span>
                  <X className='h-3 w-3' />
                </Button>
              ))}

              {/* Text Search Badge (if present) */}
              {hasTextSearch && (
                <Button
                  variant='outline'
                  className='h-6 flex-shrink-0 gap-1 rounded-[6px] px-2 text-[11px]'
                  onClick={(e) => {
                    e.preventDefault()
                    handleFiltersChange(appliedFilters, '')
                  }}
                >
                  <span className='text-[var(--text-primary)]'>"{textSearch}"</span>
                  <X className='h-3 w-3' />
                </Button>
              )}

              {/* Input - only current typing */}
              <input
                ref={inputRef}
                type='text'
                placeholder={hasFilters || hasTextSearch ? '' : placeholder}
                value={currentInput}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={handleFocus}
                onBlur={handleBlur}
                className='min-w-[80px] flex-1 border-0 bg-transparent px-0 font-medium text-[var(--text-secondary)] text-small leading-none outline-none placeholder:text-[var(--text-subtle)] focus-visible:ring-0 focus-visible:ring-offset-0 md:text-sm'
              />
            </div>

            {/* Clear All Button */}
            {(hasFilters || hasTextSearch) && (
              <button
                type='button'
                className='mr-[8px] ml-[6px] flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center text-[var(--text-subtle)] transition-colors hover:text-[var(--text-secondary)]'
                onClick={clearAll}
              >
                <X className='h-[14px] w-[14px]' />
              </button>
            )}
          </div>
        </PopoverAnchor>

        {/* Dropdown */}
        <PopoverContent
          ref={dropdownRef}
          className='p-0'
          style={{ width: dropdownWidth }}
          align='start'
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className='max-h-96 overflow-y-auto'>
            {sections.length > 0 ? (
              // Multi-section layout
              <div className='py-1'>
                {/* Show all results (no header) */}
                {suggestions[0]?.category === 'show-all' && (
                  <button
                    key={suggestions[0].id}
                    data-index={0}
                    className={cn(
                      'w-full px-3 py-1.5 text-left transition-colors focus:outline-none',
                      'hover:bg-[var(--surface-9)] dark:hover:bg-[var(--surface-9)]',
                      highlightedIndex === 0 && 'bg-[var(--surface-9)] dark:bg-[var(--surface-9)]'
                    )}
                    onMouseEnter={() => setHighlightedIndex(0)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleSuggestionSelect(suggestions[0])
                    }}
                  >
                    <div className='text-[13px]'>{suggestions[0].label}</div>
                  </button>
                )}

                {sections.map((section) => (
                  <div key={section.title}>
                    <div className='border-[var(--divider)] border-t px-3 py-1.5 font-medium text-[11px] text-[var(--text-tertiary)] uppercase tracking-wide'>
                      {section.title}
                    </div>
                    {section.suggestions.map((suggestion) => {
                      if (suggestion.category === 'show-all') return null

                      const index = suggestions.indexOf(suggestion)
                      const isHighlighted = index === highlightedIndex

                      return (
                        <button
                          key={suggestion.id}
                          data-index={index}
                          className={cn(
                            'w-full px-3 py-1.5 text-left transition-colors focus:outline-none',
                            'hover:bg-[var(--surface-9)] dark:hover:bg-[var(--surface-9)]',
                            isHighlighted && 'bg-[var(--surface-9)] dark:bg-[var(--surface-9)]'
                          )}
                          onMouseEnter={() => setHighlightedIndex(index)}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            handleSuggestionSelect(suggestion)
                          }}
                        >
                          <div className='flex items-center justify-between gap-3'>
                            <div className='flex min-w-0 flex-1 items-center gap-2'>
                              {suggestion.category === 'trigger' && suggestion.color && (
                                <div
                                  className='h-2 w-2 flex-shrink-0 rounded-full'
                                  style={{ backgroundColor: suggestion.color }}
                                />
                              )}
                              <div className='min-w-0 flex-1 truncate text-[13px]'>
                                {suggestion.label}
                              </div>
                            </div>
                            {suggestion.value !== suggestion.label && (
                              <div className='flex-shrink-0 font-mono text-[11px] text-[var(--text-muted)]'>
                                {suggestion.category === 'workflow' ||
                                suggestion.category === 'folder'
                                  ? `${suggestion.category}:`
                                  : ''}
                              </div>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            ) : (
              // Single section layout
              <div className='py-1'>
                {suggestionType === 'filters' && (
                  <div className='border-[var(--divider)] border-b px-3 py-1.5 font-medium text-[11px] text-[var(--text-tertiary)] uppercase tracking-wide'>
                    SUGGESTED FILTERS
                  </div>
                )}

                {suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.id}
                    data-index={index}
                    className={cn(
                      'w-full px-3 py-1.5 text-left transition-colors focus:outline-none',
                      'hover:bg-[var(--surface-9)] dark:hover:bg-[var(--surface-9)]',
                      index === highlightedIndex &&
                        'bg-[var(--surface-9)] dark:bg-[var(--surface-9)]'
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleSuggestionSelect(suggestion)
                    }}
                  >
                    <div className='flex items-center justify-between gap-3'>
                      <div className='flex min-w-0 flex-1 items-center gap-2'>
                        {suggestion.category === 'trigger' && suggestion.color && (
                          <div
                            className='h-2 w-2 flex-shrink-0 rounded-full'
                            style={{ backgroundColor: suggestion.color }}
                          />
                        )}
                        <div className='min-w-0 flex-1 text-[13px]'>{suggestion.label}</div>
                      </div>
                      {suggestion.description && (
                        <div className='flex-shrink-0 text-[11px] text-[var(--text-muted)]'>
                          {suggestion.value}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
