import { useCallback, useRef, useState } from 'react'
import type { ParsedFilter } from '@/lib/logs/query-parser'
import type {
  Suggestion,
  SuggestionGroup,
  SuggestionSection,
} from '@/app/workspace/[workspaceId]/logs/types/search'

interface UseSearchStateOptions {
  onFiltersChange: (filters: ParsedFilter[], textSearch: string) => void
  getSuggestions: (input: string) => SuggestionGroup | null
  debounceMs?: number
}

export function useSearchState({
  onFiltersChange,
  getSuggestions,
  debounceMs = 100,
}: UseSearchStateOptions) {
  const [appliedFilters, setAppliedFilters] = useState<ParsedFilter[]>([])
  const [currentInput, setCurrentInput] = useState('')
  const [textSearch, setTextSearch] = useState('')

  // Dropdown state
  const [isOpen, setIsOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [sections, setSections] = useState<SuggestionSection[]>([])
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  // Badge interaction
  const [highlightedBadgeIndex, setHighlightedBadgeIndex] = useState<number | null>(null)

  // Refs
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  // Update suggestions when input changes
  const updateSuggestions = useCallback(
    (input: string) => {
      const suggestionGroup = getSuggestions(input)

      if (suggestionGroup && suggestionGroup.suggestions.length > 0) {
        setSuggestions(suggestionGroup.suggestions)
        setSections(suggestionGroup.sections || [])
        setIsOpen(true)
        setHighlightedIndex(0)
      } else {
        setIsOpen(false)
        setSuggestions([])
        setSections([])
        setHighlightedIndex(-1)
      }
    },
    [getSuggestions]
  )

  // Handle input changes
  const handleInputChange = useCallback(
    (value: string) => {
      setCurrentInput(value)
      setHighlightedBadgeIndex(null) // Clear badge highlight on any input

      // Debounce suggestion updates
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        updateSuggestions(value)
      }, debounceMs)
    },
    [updateSuggestions, debounceMs]
  )

  // Handle suggestion selection
  const handleSuggestionSelect = useCallback(
    (suggestion: Suggestion) => {
      if (suggestion.category === 'show-all') {
        // Treat as text search
        setTextSearch(suggestion.value)
        setCurrentInput('')
        setIsOpen(false)
        onFiltersChange(appliedFilters, suggestion.value)
        return
      }

      // Check if this is a filter-key suggestion (ends with ':')
      if (suggestion.category === 'filters' && suggestion.value.endsWith(':')) {
        // Set input to the filter key and keep dropdown open for values
        setCurrentInput(suggestion.value)
        updateSuggestions(suggestion.value)
        return
      }

      // For filter values, workflows, folders - add as a filter
      const newFilter: ParsedFilter = {
        field: suggestion.value.split(':')[0] as any,
        operator: '=',
        value: suggestion.value.includes(':')
          ? suggestion.value.split(':').slice(1).join(':').replace(/"/g, '')
          : suggestion.value.replace(/"/g, ''),
        originalValue: suggestion.value.includes(':')
          ? suggestion.value.split(':').slice(1).join(':')
          : suggestion.value,
      }

      const updatedFilters = [...appliedFilters, newFilter]
      setAppliedFilters(updatedFilters)
      setCurrentInput('')
      setTextSearch('')

      // Notify parent
      onFiltersChange(updatedFilters, '')

      // Focus back on input and reopen dropdown with empty suggestions
      if (inputRef.current) {
        inputRef.current.focus()
      }

      // Show filter keys dropdown again after selection
      setTimeout(() => {
        updateSuggestions('')
      }, 50)
    },
    [appliedFilters, onFiltersChange, updateSuggestions]
  )

  // Remove a badge
  const removeBadge = useCallback(
    (index: number) => {
      const updatedFilters = appliedFilters.filter((_, i) => i !== index)
      setAppliedFilters(updatedFilters)
      setHighlightedBadgeIndex(null)
      onFiltersChange(updatedFilters, textSearch)

      if (inputRef.current) {
        inputRef.current.focus()
      }
    },
    [appliedFilters, textSearch, onFiltersChange]
  )

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Backspace on empty input - badge deletion
      if (event.key === 'Backspace' && currentInput === '') {
        event.preventDefault()

        if (highlightedBadgeIndex !== null) {
          // Delete highlighted badge
          removeBadge(highlightedBadgeIndex)
        } else if (appliedFilters.length > 0) {
          // Highlight last badge
          setHighlightedBadgeIndex(appliedFilters.length - 1)
        }
        return
      }

      // Clear badge highlight on any other key when not in dropdown navigation
      if (
        highlightedBadgeIndex !== null &&
        !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)
      ) {
        setHighlightedBadgeIndex(null)
      }

      // Enter key
      if (event.key === 'Enter') {
        event.preventDefault()

        if (isOpen && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
          handleSuggestionSelect(suggestions[highlightedIndex])
        } else if (currentInput.trim()) {
          // Submit current input as text search
          setTextSearch(currentInput.trim())
          setCurrentInput('')
          setIsOpen(false)
          onFiltersChange(appliedFilters, currentInput.trim())
        }
        return
      }

      // Dropdown navigation
      if (!isOpen) return

      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault()
          setHighlightedIndex((prev) => Math.min(prev + 1, suggestions.length - 1))
          break
        }

        case 'ArrowUp': {
          event.preventDefault()
          setHighlightedIndex((prev) => Math.max(prev - 1, 0))
          break
        }

        case 'Escape': {
          event.preventDefault()
          setIsOpen(false)
          setHighlightedIndex(-1)
          break
        }

        case 'Tab': {
          if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
            event.preventDefault()
            handleSuggestionSelect(suggestions[highlightedIndex])
          }
          break
        }
      }
    },
    [
      currentInput,
      highlightedBadgeIndex,
      appliedFilters,
      isOpen,
      highlightedIndex,
      suggestions,
      handleSuggestionSelect,
      removeBadge,
      onFiltersChange,
    ]
  )

  // Handle focus
  const handleFocus = useCallback(() => {
    updateSuggestions(currentInput)
  }, [currentInput, updateSuggestions])

  // Handle blur
  const handleBlur = useCallback(() => {
    setTimeout(() => {
      setIsOpen(false)
      setHighlightedIndex(-1)
    }, 150)
  }, [])

  // Clear all filters
  const clearAll = useCallback(() => {
    setAppliedFilters([])
    setCurrentInput('')
    setTextSearch('')
    setIsOpen(false)
    onFiltersChange([], '')

    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [onFiltersChange])

  // Initialize from external value (URL params, etc.)
  const initializeFromQuery = useCallback((query: string, filters: ParsedFilter[]) => {
    setAppliedFilters(filters)
    setTextSearch(query)
    setCurrentInput('')
  }, [])

  return {
    // State
    appliedFilters,
    currentInput,
    textSearch,
    isOpen,
    suggestions,
    sections,
    highlightedIndex,
    highlightedBadgeIndex,

    // Refs
    inputRef,
    dropdownRef,

    // Handlers
    handleInputChange,
    handleSuggestionSelect,
    handleKeyDown,
    handleFocus,
    handleBlur,
    removeBadge,
    clearAll,
    initializeFromQuery,

    // Setters for external control
    setHighlightedIndex,
  }
}
