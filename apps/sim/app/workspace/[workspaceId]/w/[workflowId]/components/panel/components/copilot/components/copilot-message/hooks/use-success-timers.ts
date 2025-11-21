'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Duration to show success indicators (in milliseconds)
 */
const SUCCESS_DISPLAY_DURATION = 2000

/**
 * Custom hook to manage auto-hiding success states
 * Automatically hides success indicators after a set duration
 *
 * @returns Success state management utilities
 */
export function useSuccessTimers() {
  const [showCopySuccess, setShowCopySuccess] = useState(false)
  const [showUpvoteSuccess, setShowUpvoteSuccess] = useState(false)
  const [showDownvoteSuccess, setShowDownvoteSuccess] = useState(false)

  /**
   * Auto-hide copy success indicator after duration
   */
  useEffect(() => {
    if (showCopySuccess) {
      const timer = setTimeout(() => {
        setShowCopySuccess(false)
      }, SUCCESS_DISPLAY_DURATION)
      return () => clearTimeout(timer)
    }
  }, [showCopySuccess])

  /**
   * Auto-hide upvote success indicator after duration
   */
  useEffect(() => {
    if (showUpvoteSuccess) {
      const timer = setTimeout(() => {
        setShowUpvoteSuccess(false)
      }, SUCCESS_DISPLAY_DURATION)
      return () => clearTimeout(timer)
    }
  }, [showUpvoteSuccess])

  /**
   * Auto-hide downvote success indicator after duration
   */
  useEffect(() => {
    if (showDownvoteSuccess) {
      const timer = setTimeout(() => {
        setShowDownvoteSuccess(false)
      }, SUCCESS_DISPLAY_DURATION)
      return () => clearTimeout(timer)
    }
  }, [showDownvoteSuccess])

  /**
   * Handles copy to clipboard action
   * @param content - Content to copy to clipboard
   */
  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content)
    setShowCopySuccess(true)
  }, [])

  return {
    // State
    showCopySuccess,
    showUpvoteSuccess,
    showDownvoteSuccess,

    // Operations
    handleCopy,
    setShowUpvoteSuccess,
    setShowDownvoteSuccess,
  }
}
