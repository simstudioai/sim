'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parseQuery } from '@/lib/logs/query-parser'
import { SearchSuggestions } from '@/lib/logs/search-suggestions'
import { cn } from '@/lib/utils'
import { useAutocomplete } from '@/app/workspace/[workspaceId]/logs/hooks/use-autocomplete'

interface AutocompleteSearchProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  availableWorkflows?: string[]
  availableFolders?: string[]
  className?: string
  onOpenChange?: (open: boolean) => void
}

export function AutocompleteSearch({
  value,
  onChange,
  placeholder = 'Search logs...',
  availableWorkflows = [],
  availableFolders = [],
  className,
  onOpenChange,
}: AutocompleteSearchProps) {
  const suggestionEngine = useMemo(() => {
    return new SearchSuggestions(availableWorkflows, availableFolders)
  }, [availableWorkflows, availableFolders])

  const {
    state,
    inputRef,
    dropdownRef,
    handleInputChange,
    handleCursorChange,
    handleSuggestionHover,
    handleSuggestionSelect,
    handleKeyDown,
    handleFocus,
    handleBlur,
    reset: resetAutocomplete,
    closeDropdown,
  } = useAutocomplete({
    getSuggestions: (inputValue, cursorPos) =>
      suggestionEngine.getSuggestions(inputValue, cursorPos),
    generatePreview: (suggestion, inputValue, cursorPos) =>
      suggestionEngine.generatePreview(suggestion, inputValue, cursorPos),
    onQueryChange: onChange,
    validateQuery: (query) => suggestionEngine.validateQuery(query),
    debounceMs: 100,
  })

  const clearAll = () => {
    resetAutocomplete()
    closeDropdown()
    onChange('')
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  const parsedQuery = parseQuery(value)
  const hasFilters = parsedQuery.filters.length > 0
  const hasTextSearch = parsedQuery.textSearch.length > 0

  const listboxId = 'logs-search-listbox'
  const inputId = 'logs-search-input'

  useEffect(() => {
    onOpenChange?.(state.isOpen)
  }, [state.isOpen, onOpenChange])

  useEffect(() => {
    if (!state.isOpen || state.highlightedIndex < 0) return
    const container = dropdownRef.current
    const optionEl = document.getElementById(`${listboxId}-option-${state.highlightedIndex}`)
    if (container && optionEl) {
      try {
        optionEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      } catch {
        optionEl.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [state.isOpen, state.highlightedIndex])

  const [showSpinner, setShowSpinner] = useState(false)
  useEffect(() => {
    if (!state.pendingQuery) {
      setShowSpinner(false)
      return
    }
    const t = setTimeout(() => setShowSpinner(true), 200)
    return () => clearTimeout(t)
  }, [state.pendingQuery])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    const cursorPos = e.target.selectionStart || 0
    handleInputChange(newValue, cursorPos)
  }

  const updateCursorPosition = (element: HTMLInputElement) => {
    const cursorPos = element.selectionStart || 0
    handleCursorChange(cursorPos)
  }

  const removeFilter = (filterToRemove: (typeof parsedQuery.filters)[0]) => {
    const remainingFilters = parsedQuery.filters.filter(
      (f) => !(f.field === filterToRemove.field && f.value === filterToRemove.value)
    )

    const filterStrings = remainingFilters.map(
      (f) => `${f.field}:${f.operator !== '=' ? f.operator : ''}${f.originalValue}`
    )

    const newQuery = [...filterStrings, parsedQuery.textSearch].filter(Boolean).join(' ')
    handleInputChange(newQuery, newQuery.length)
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  return (
    <div className={cn('relative', className)}>
      {/* Search Input */}
      <div
        className={cn(
          'relative flex items-center gap-2 rounded-lg border bg-background pr-2 pl-3 transition-all duration-200',
          'h-9 w-full min-w-[600px] max-w-[800px]',
          state.isOpen && 'ring-1 ring-ring'
        )}
      >
        {showSpinner ? (
          <Loader2 className='h-4 w-4 flex-shrink-0 animate-spin text-muted-foreground' />
        ) : (
          <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
        )}

        {/* Text display with ghost text */}
        <div className='relative flex-1 font-[380] font-sans text-base leading-none'>
          {/* Invisible input for cursor and interactions */}
          <Input
            ref={inputRef}
            id={inputId}
            placeholder={state.inputValue ? '' : placeholder}
            value={state.inputValue}
            onChange={onInputChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onClick={(e) => updateCursorPosition(e.currentTarget)}
            onKeyDown={handleKeyDown}
            onSelect={(e) => updateCursorPosition(e.currentTarget)}
            className='relative z-10 w-full border-0 bg-transparent p-0 font-[380] font-sans text-base text-transparent leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
            style={{ background: 'transparent' }}
            role='combobox'
            aria-expanded={state.isOpen}
            aria-controls={state.isOpen ? listboxId : undefined}
            aria-autocomplete='list'
            aria-activedescendant={
              state.isOpen && state.highlightedIndex >= 0
                ? `${listboxId}-option-${state.highlightedIndex}`
                : undefined
            }
          />

          {/* Always-visible text overlay */}
          <div className='pointer-events-none absolute inset-0 flex items-center'>
            <span className='whitespace-pre font-[380] font-sans text-base leading-none'>
              <span className='text-foreground'>{state.inputValue}</span>
              {state.showPreview &&
                state.previewValue &&
                state.previewValue !== state.inputValue &&
                state.inputValue && (
                  <span className='text-muted-foreground/50'>
                    {state.previewValue.slice(state.inputValue.length)}
                  </span>
                )}
            </span>
          </div>
        </div>

        {/* Clear all button */}
        {(hasFilters || hasTextSearch) && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-6 w-6 p-0 hover:bg-muted/50'
            onMouseDown={(e) => {
              e.preventDefault()
              clearAll()
            }}
          >
            <X className='h-3 w-3' />
          </Button>
        )}
      </div>

      {/* Suggestions Dropdown */}
      {state.isOpen && state.suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className='min-w[500px] absolute z-[9999] mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md'
          id={listboxId}
          role='listbox'
          aria-labelledby={inputId}
        >
          <div className='max-h-96 overflow-y-auto py-1'>
            {state.suggestionType === 'filter-keys' && (
              <div className='border-border/50 border-b px-3 py-1 font-medium text-muted-foreground/70 text-xs uppercase tracking-wide'>
                SUGGESTED FILTERS
              </div>
            )}
            {state.suggestionType === 'filter-values' && (
              <div className='border-border/50 border-b px-3 py-1 font-medium text-muted-foreground/70 text-xs uppercase tracking-wide'>
                {state.suggestions[0]?.category?.toUpperCase() || 'VALUES'}
              </div>
            )}

            {state.suggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                className={cn(
                  'w-full px-3 py-2 text-left text-sm',
                  'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                  'transition-colors hover:bg-accent hover:text-accent-foreground',
                  index === state.highlightedIndex && 'bg-accent text-accent-foreground'
                )}
                onMouseEnter={() => {
                  if (typeof window !== 'undefined' && (window as any).__logsKeyboardNavActive) {
                    return
                  }
                  handleSuggestionHover(index)
                }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleSuggestionSelect(suggestion)
                }}
                id={`${listboxId}-option-${index}`}
                role='option'
                aria-selected={index === state.highlightedIndex}
              >
                <div className='flex items-center justify-between'>
                  <div className='flex-1'>
                    <div className='font-medium text-sm'>{suggestion.label}</div>
                    {suggestion.description && (
                      <div className='mt-0.5 text-muted-foreground text-xs'>
                        {suggestion.description}
                      </div>
                    )}
                  </div>
                  <div className='ml-4 font-mono text-muted-foreground text-xs'>
                    {suggestion.value}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active filters as chips */}
      {hasFilters && (
        <div className='mt-3 flex flex-wrap items-center gap-2'>
          <span className='font-medium text-muted-foreground text-xs'>ACTIVE FILTERS:</span>
          {parsedQuery.filters.map((filter, index) => (
            <Badge
              key={`${filter.field}-${filter.value}-${index}`}
              variant='secondary'
              className='h-6 border border-border/50 bg-muted/50 font-mono text-muted-foreground text-xs hover:bg-muted'
            >
              <span className='mr-1'>{filter.field}:</span>
              <span>
                {filter.operator !== '=' && filter.operator}
                {filter.originalValue}
              </span>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='ml-1 h-3 w-3 p-0 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                onClick={() => removeFilter(filter)}
              >
                <X className='h-2.5 w-2.5' />
              </Button>
            </Badge>
          ))}
          {parsedQuery.filters.length > 1 && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-6 text-muted-foreground text-xs hover:text-foreground'
              onMouseDown={(e) => {
                e.preventDefault()
                const newQuery = parsedQuery.textSearch
                handleInputChange(newQuery, newQuery.length)
                if (inputRef.current) {
                  inputRef.current.focus()
                }
              }}
            >
              Clear all
            </Button>
          )}
        </div>
      )}

      {/* Text search indicator */}
      {hasTextSearch && (
        <div className='mt-2 flex items-center gap-2'>
          <span className='font-medium text-muted-foreground text-xs'>TEXT SEARCH:</span>
          <Badge variant='outline' className='text-xs'>
            "{parsedQuery.textSearch}"
          </Badge>
        </div>
      )}
    </div>
  )
}
