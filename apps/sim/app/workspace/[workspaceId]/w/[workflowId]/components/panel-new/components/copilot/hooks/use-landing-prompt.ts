'use client'

import { useEffect, useRef } from 'react'
import { LandingPromptStorage } from '@/lib/browser-storage'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('useLandingPrompt')

interface UseLandingPromptProps {
  /**
   * Whether the copilot is fully initialized and ready to receive input
   */
  isInitialized: boolean

  /**
   * Callback to set the input value in the copilot
   */
  setInputValue: (value: string) => void

  /**
   * Callback to focus the copilot input
   */
  focusInput: () => void

  /**
   * Whether a message is currently being sent (prevents overwriting during active chat)
   */
  isSendingMessage: boolean

  /**
   * Current input value (to avoid overwriting if user has already typed)
   */
  currentInputValue: string
}

/**
 * Custom hook to handle landing page prompt retrieval and population
 *
 * When a user enters a prompt on the landing page and signs up/logs in,
 * this hook retrieves that prompt from localStorage and populates it
 * in the copilot input once the copilot is initialized.
 *
 * @param props - Configuration for landing prompt handling
 */
export function useLandingPrompt(props: UseLandingPromptProps) {
  const { isInitialized, setInputValue, focusInput, isSendingMessage, currentInputValue } = props

  const hasCheckedRef = useRef(false)

  useEffect(() => {
    // Only check once when copilot is first initialized
    if (!isInitialized || hasCheckedRef.current || isSendingMessage) {
      return
    }

    // If user has already started typing, don't override
    if (currentInputValue && currentInputValue.trim().length > 0) {
      hasCheckedRef.current = true
      return
    }

    // Try to retrieve the stored prompt (max age: 24 hours)
    const prompt = LandingPromptStorage.consume()

    if (prompt) {
      logger.info('Retrieved landing page prompt, populating copilot input')
      setInputValue(prompt)

      // Focus the input after a brief delay to ensure DOM is ready
      setTimeout(() => {
        focusInput()
      }, 150)
    }

    hasCheckedRef.current = true
  }, [isInitialized, setInputValue, focusInput, isSendingMessage, currentInputValue])
}
