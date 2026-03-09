import { useCallback, useRef, useState } from 'react'
import type { ParsedFilter } from '@/lib/logs/query-parser'
import type {
  Suggestion,
  SuggestionGroup,
  SuggestionSection,
} from '@/app/workspace/[workspaceId]/logs/types'

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

  const [isOpen, setIsOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [sections, setSections] = useState<SuggestionSection[]>([])
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  const [highlightedBadgeIndex, setHighlightedBadgeIndex] = useState<number | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

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

  const handleInputChange = useCallback(
    (value: string) => {
      setCurrentInput(value)
      setHighlightedBadgeIndex(null)

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        updateSuggestions(value)
      }, debounceMs)
    },
    [updateSuggestions, debounceMs]
  )

  const handleSuggestionSelect = useCallback(
    (suggestion: Suggestion) => {
      if (suggestion.category === 'show-all') {
        setTextSearch(suggestion.value)
        setCurrentInput('')
        setIsOpen(false)
        onFiltersChange(appliedFilters, suggestion.value)
        return
      }

      if (suggestion.category === 'filters' && suggestion.value.endsWith(':')) {
        setCurrentInput(suggestion.value)
        updateSuggestions(suggestion.value)
        return
      }

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

      onFiltersChange(updatedFilters, '')

      if (inputRef.current) {
        inputRef.current.focus()
      }

      setTimeout(() => {
        updateSuggestions('')
      }, 50)
    },
    [appliedFilters, onFiltersChange, updateSuggestions]
  )

  const removeBadge = useCallback(
    (index: number) => {
      const updatedFilters = appliedFilters.filter((_, i) => i !== index)
      setAppliedFilters(updatedFilters)
      onFiltersChange(updatedFilters, textSearch)

      if (inputRef.current) {
        inputRef.current.focus()
      }
    },
    [appliedFilters, textSearch, onFiltersChange]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Backspace' && currentInput === '') {
        event.preventDefault()

        if (highlightedBadgeIndex !== null) {
          removeBadge(highlightedBadgeIndex)
          setHighlightedBadgeIndex(null)
        } else if (appliedFilters.length > 0) {
          setHighlightedBadgeIndex(appliedFilters.length - 1)
        }
        return
      }

      if (
        highlightedBadgeIndex !== null &&
        !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)
      ) {
        setHighlightedBadgeIndex(null)
      }

      if (event.key === 'Enter') {
        event.preventDefault()

        if (isOpen && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
          handleSuggestionSelect(suggestions[highlightedIndex])
        } else if (currentInput.trim()) {
          setTextSearch(currentInput.trim())
          setCurrentInput('')
          setIsOpen(false)
          onFiltersChange(appliedFilters, currentInput.trim())
        }
        return
      }

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
      appliedFilters,
      highlightedBadgeIndex,
      isOpen,
      highlightedIndex,
      suggestions,
      handleSuggestionSelect,
      removeBadge,
      onFiltersChange,
    ]
  )

  const handleFocus = useCallback(() => {
    updateSuggestions(currentInput)
  }, [currentInput, updateSuggestions])

  const handleBlur = useCallback(() => {
    setTimeout(() => {
      setIsOpen(false)
      setHighlightedIndex(-1)
    }, 150)
  }, [])

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

  const initializeFromQuery = useCallback((query: string, filters: ParsedFilter[]) => {
    setAppliedFilters(filters)
    setTextSearch(query)
    setCurrentInput('')
  }, [])

  return {
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
    initializeFromQuery,
    setHighlightedIndex,
    setHighlightedBadgeIndex,
  }
}
