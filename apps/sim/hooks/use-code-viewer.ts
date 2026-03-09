'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseCodeViewerFeaturesOptions {
  /** Reference to the content container for scroll-to-match functionality */
  contentRef?: React.RefObject<HTMLDivElement | null>
  /** Initial wrap text state (ignored if externalWrapText is provided) */
  initialWrapText?: boolean
  /** External wrap text state (e.g., from Zustand store) */
  externalWrapText?: boolean
  /** External setter for wrap text (required if externalWrapText is provided) */
  onWrapTextChange?: (wrap: boolean) => void
  /** Callback when escape is pressed (optional, for custom handling) */
  onEscape?: () => void
}

interface UseCodeViewerFeaturesReturn {
  wrapText: boolean
  setWrapText: (wrap: boolean) => void
  toggleWrapText: () => void

  isSearchActive: boolean
  searchQuery: string
  setSearchQuery: (query: string) => void
  matchCount: number
  currentMatchIndex: number
  activateSearch: () => void
  closeSearch: () => void
  goToNextMatch: () => void
  goToPreviousMatch: () => void
  handleMatchCountChange: (count: number) => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
}

/**
 * Reusable hook for Code.Viewer features: search and wrap text functionality.
 * Supports both internal state and external state (e.g., from Zustand) for wrapText.
 */
export function useCodeViewerFeatures(
  options: UseCodeViewerFeaturesOptions = {}
): UseCodeViewerFeaturesReturn {
  const {
    contentRef,
    initialWrapText = true,
    externalWrapText,
    onWrapTextChange,
    onEscape,
  } = options

  // Use external state if provided, otherwise use internal state
  const [internalWrapText, setInternalWrapText] = useState(initialWrapText)
  const wrapText = externalWrapText !== undefined ? externalWrapText : internalWrapText
  const setWrapText = onWrapTextChange ?? setInternalWrapText

  const [isSearchActive, setIsSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const toggleWrapText = useCallback(() => {
    setWrapText(!wrapText)
  }, [wrapText, setWrapText])

  const activateSearch = useCallback(() => {
    setIsSearchActive(true)
    setTimeout(() => {
      searchInputRef.current?.focus()
    }, 0)
  }, [])

  const closeSearch = useCallback(() => {
    setIsSearchActive(false)
    setSearchQuery('')
    setMatchCount(0)
    setCurrentMatchIndex(0)
  }, [])

  const goToNextMatch = useCallback(() => {
    if (matchCount === 0) return
    setCurrentMatchIndex((prev) => (prev + 1) % matchCount)
  }, [matchCount])

  const goToPreviousMatch = useCallback(() => {
    if (matchCount === 0) return
    setCurrentMatchIndex((prev) => (prev - 1 + matchCount) % matchCount)
  }, [matchCount])

  const handleMatchCountChange = useCallback((count: number) => {
    setMatchCount(count)
    setCurrentMatchIndex(0)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSearchActive) {
        e.preventDefault()
        closeSearch()
        onEscape?.()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSearchActive, closeSearch, onEscape])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isSearchActive) return

      const isSearchInputFocused = document.activeElement === searchInputRef.current

      if (e.key === 'Enter' && isSearchInputFocused && matchCount > 0) {
        e.preventDefault()
        if (e.shiftKey) {
          goToPreviousMatch()
        } else {
          goToNextMatch()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSearchActive, matchCount, goToNextMatch, goToPreviousMatch])

  useEffect(() => {
    if (!isSearchActive || matchCount === 0 || !contentRef?.current) return

    const matchElements = contentRef.current.querySelectorAll('[data-search-match]')
    const currentElement = matchElements[currentMatchIndex]

    if (currentElement) {
      currentElement.scrollIntoView({ block: 'center' })
    }
  }, [currentMatchIndex, isSearchActive, matchCount, contentRef])

  return {
    wrapText,
    setWrapText,
    toggleWrapText,
    isSearchActive,
    searchQuery,
    setSearchQuery,
    matchCount,
    currentMatchIndex,
    activateSearch,
    closeSearch,
    goToNextMatch,
    goToPreviousMatch,
    handleMatchCountChange,
    searchInputRef,
  }
}
