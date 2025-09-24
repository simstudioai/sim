import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'

export interface Suggestion {
  id: string
  value: string
  label: string
  description?: string
  category?:
    | 'filters'
    | 'level'
    | 'trigger'
    | 'cost'
    | 'date'
    | 'duration'
    | 'workflow'
    | 'folder'
    | 'workflowId'
    | 'executionId'
}

export interface SuggestionGroup {
  type: 'filter-keys' | 'filter-values'
  filterKey?: string
  suggestions: Suggestion[]
}

interface AutocompleteState {
  // Input state
  inputValue: string
  cursorPosition: number

  // Dropdown state
  isOpen: boolean
  suggestions: Suggestion[]
  suggestionType: 'filter-keys' | 'filter-values' | null
  highlightedIndex: number

  // Preview state
  previewValue: string
  showPreview: boolean

  // Query state
  isValidQuery: boolean
  pendingQuery: string | null
}

type AutocompleteAction =
  | { type: 'SET_INPUT_VALUE'; payload: { value: string; cursorPosition: number } }
  | { type: 'SET_CURSOR_POSITION'; payload: number }
  | { type: 'OPEN_DROPDOWN'; payload: SuggestionGroup }
  | { type: 'CLOSE_DROPDOWN' }
  | { type: 'HIGHLIGHT_SUGGESTION'; payload: { index: number; preview?: string } }
  | { type: 'SET_PREVIEW'; payload: { value: string; show: boolean } }
  | { type: 'CLEAR_PREVIEW' }
  | { type: 'SET_QUERY_VALIDITY'; payload: boolean }
  | { type: 'SET_PENDING'; payload: string | null }
  | { type: 'RESET' }

const initialState: AutocompleteState = {
  inputValue: '',
  cursorPosition: 0,
  isOpen: false,
  suggestions: [],
  suggestionType: null,
  highlightedIndex: -1,
  previewValue: '',
  showPreview: false,
  isValidQuery: true,
  pendingQuery: null,
}

function autocompleteReducer(
  state: AutocompleteState,
  action: AutocompleteAction
): AutocompleteState {
  switch (action.type) {
    case 'SET_INPUT_VALUE':
      return {
        ...state,
        inputValue: action.payload.value,
        cursorPosition: action.payload.cursorPosition,
        previewValue: '',
        showPreview: false,
      }

    case 'SET_CURSOR_POSITION':
      return {
        ...state,
        cursorPosition: action.payload,
      }

    case 'OPEN_DROPDOWN':
      return {
        ...state,
        isOpen: true,
        suggestions: action.payload.suggestions,
        suggestionType: action.payload.type,
        highlightedIndex: action.payload.suggestions.length > 0 ? 0 : -1,
      }

    case 'CLOSE_DROPDOWN':
      return {
        ...state,
        isOpen: false,
        suggestions: [],
        suggestionType: null,
        highlightedIndex: -1,
        previewValue: '',
        showPreview: false,
      }

    case 'HIGHLIGHT_SUGGESTION':
      return {
        ...state,
        highlightedIndex: action.payload.index,
        previewValue: action.payload.preview || '',
        showPreview: !!action.payload.preview,
      }

    case 'SET_PREVIEW':
      return {
        ...state,
        previewValue: action.payload.value,
        showPreview: action.payload.show,
      }

    case 'CLEAR_PREVIEW':
      return {
        ...state,
        previewValue: '',
        showPreview: false,
      }

    case 'SET_QUERY_VALIDITY':
      return {
        ...state,
        isValidQuery: action.payload,
      }

    case 'SET_PENDING':
      return {
        ...state,
        pendingQuery: action.payload,
      }

    case 'RESET':
      return initialState

    default:
      return state
  }
}

export interface AutocompleteOptions {
  getSuggestions: (value: string, cursorPosition: number) => SuggestionGroup | null
  generatePreview: (suggestion: Suggestion, currentValue: string, cursorPosition: number) => string
  onQueryChange: (query: string) => void
  validateQuery?: (query: string) => boolean
  debounceMs?: number
}

export function useAutocomplete({
  getSuggestions,
  generatePreview,
  onQueryChange,
  validateQuery,
  debounceMs = 150,
}: AutocompleteOptions) {
  const [state, dispatch] = useReducer(autocompleteReducer, initialState)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const pointerDownInDropdownRef = useRef<boolean>(false)
  const latestRef = useRef<{ inputValue: string; cursorPosition: number }>({
    inputValue: '',
    cursorPosition: 0,
  })

  useEffect(() => {
    latestRef.current.inputValue = state.inputValue
    latestRef.current.cursorPosition = state.cursorPosition
  }, [state.inputValue, state.cursorPosition])

  const currentSuggestion = useMemo(() => {
    if (state.highlightedIndex >= 0 && state.suggestions[state.highlightedIndex]) {
      return state.suggestions[state.highlightedIndex]
    }
    return null
  }, [state.highlightedIndex, state.suggestions])

  const updateSuggestions = useCallback(() => {
    const { inputValue, cursorPosition } = latestRef.current
    const suggestionGroup = getSuggestions(inputValue, cursorPosition)

    if (suggestionGroup && suggestionGroup.suggestions.length > 0) {
      dispatch({ type: 'OPEN_DROPDOWN', payload: suggestionGroup })

      const firstSuggestion = suggestionGroup.suggestions[0]
      const preview = generatePreview(firstSuggestion, inputValue, cursorPosition)
      dispatch({
        type: 'HIGHLIGHT_SUGGESTION',
        payload: { index: 0, preview },
      })
    } else {
      dispatch({ type: 'CLOSE_DROPDOWN' })
    }
  }, [getSuggestions, generatePreview])

  const handleInputChange = useCallback(
    (value: string, cursorPosition: number) => {
      dispatch({ type: 'SET_INPUT_VALUE', payload: { value, cursorPosition } })

      const isValid = validateQuery ? validateQuery(value) : true
      dispatch({ type: 'SET_QUERY_VALIDITY', payload: isValid })

      if (isValid) {
        onQueryChange(value)
      }

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      dispatch({ type: 'SET_PENDING', payload: value })
      debounceRef.current = setTimeout(() => {
        dispatch({ type: 'SET_PENDING', payload: null })
        updateSuggestions()
      }, debounceMs)
    },
    [updateSuggestions, onQueryChange, validateQuery, debounceMs]
  )

  const handleCursorChange = useCallback(
    (position: number) => {
      dispatch({ type: 'SET_CURSOR_POSITION', payload: position })
      updateSuggestions()
    },
    [updateSuggestions]
  )

  const handleSuggestionHover = useCallback(
    (index: number) => {
      if (index >= 0 && index < state.suggestions.length) {
        const suggestion = state.suggestions[index]
        const preview = generatePreview(suggestion, state.inputValue, state.cursorPosition)
        dispatch({
          type: 'HIGHLIGHT_SUGGESTION',
          payload: { index, preview },
        })
      }
    },
    [state.suggestions, state.inputValue, state.cursorPosition, generatePreview]
  )

  const handleSuggestionSelect = useCallback(
    (suggestion?: Suggestion) => {
      const selectedSuggestion = suggestion || currentSuggestion
      if (!selectedSuggestion) return

      let newValue = generatePreview(selectedSuggestion, state.inputValue, state.cursorPosition)

      let newCursorPosition = newValue.length

      if (state.suggestionType === 'filter-keys' && selectedSuggestion.value.endsWith(':')) {
        newCursorPosition = newValue.lastIndexOf(':') + 1
      } else if (state.suggestionType === 'filter-values') {
        newValue = `${newValue} `
        newCursorPosition = newValue.length
      }

      dispatch({
        type: 'SET_INPUT_VALUE',
        payload: { value: newValue, cursorPosition: newCursorPosition },
      })

      const isValid = validateQuery ? validateQuery(newValue.trim()) : true
      dispatch({ type: 'SET_QUERY_VALIDITY', payload: isValid })

      if (isValid) {
        onQueryChange(newValue.trim())
      }

      if (inputRef.current) {
        inputRef.current.focus()
        requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.setSelectionRange(newCursorPosition, newCursorPosition)
          }
        })
      }

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      dispatch({ type: 'SET_PENDING', payload: null })
      setTimeout(updateSuggestions, 0)
    },
    [
      currentSuggestion,
      state.inputValue,
      state.cursorPosition,
      state.suggestionType,
      generatePreview,
      onQueryChange,
      validateQuery,
      updateSuggestions,
    ]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        if (state.isOpen) {
          handleSuggestionSelect()
        } else if (state.isValidQuery) {
          updateSuggestions()
        }
        return
      }

      if (!state.isOpen) return

      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault()
          const nextIndex = Math.min(state.highlightedIndex + 1, state.suggestions.length - 1)
          handleSuggestionHover(nextIndex)
          break
        }

        case 'ArrowUp': {
          event.preventDefault()
          const prevIndex = Math.max(state.highlightedIndex - 1, 0)
          handleSuggestionHover(prevIndex)
          break
        }

        case 'Escape':
          event.preventDefault()
          dispatch({ type: 'CLOSE_DROPDOWN' })
          break

        case 'Tab':
          if (currentSuggestion) {
            event.preventDefault()
            handleSuggestionSelect()
          } else {
            dispatch({ type: 'CLOSE_DROPDOWN' })
          }
          break
      }
    },
    [
      state.isOpen,
      state.highlightedIndex,
      state.suggestions.length,
      handleSuggestionHover,
      handleSuggestionSelect,
      currentSuggestion,
    ]
  )

  const handleFocus = useCallback(() => {
    updateSuggestions()
  }, [updateSuggestions])

  const handleBlur = useCallback((e?: React.FocusEvent) => {
    const related = (e?.relatedTarget as Node) || document.activeElement
    const isInsideDropdown = related && dropdownRef.current?.contains(related)
    const isInsideInput = related && inputRef.current === related
    if (pointerDownInDropdownRef.current || isInsideDropdown || isInsideInput) {
      return
    }
    setTimeout(() => {
      dispatch({ type: 'CLOSE_DROPDOWN' })
    }, 150)
  }, [])

  useEffect(() => {
    const dropdownEl = dropdownRef.current
    if (!dropdownEl) return
    const onPointerDown = () => {
      pointerDownInDropdownRef.current = true
    }
    const onPointerUp = () => {
      setTimeout(() => {
        pointerDownInDropdownRef.current = false
      }, 0)
    }
    dropdownEl.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      dropdownEl.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [])

  return {
    // State
    state,
    currentSuggestion,

    // Refs
    inputRef,
    dropdownRef,

    // Handlers
    handleInputChange,
    handleCursorChange,
    handleSuggestionHover,
    handleSuggestionSelect,
    handleKeyDown,
    handleFocus,
    handleBlur,

    // Actions
    closeDropdown: () => dispatch({ type: 'CLOSE_DROPDOWN' }),
    clearPreview: () => dispatch({ type: 'CLEAR_PREVIEW' }),
    reset: () => dispatch({ type: 'RESET' }),
  }
}
