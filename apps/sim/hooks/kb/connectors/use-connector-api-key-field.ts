'use client'

import { useRef, useState } from 'react'
import { useAvailableEnvVarKeys } from '@/hooks/use-available-env-vars'
import { checkEnvVarTrigger } from '@/hooks/use-env-var-suggestions'

const NO_ENV_VARS = new Set<string>()

interface ConnectorApiKeyFieldOptions {
  value: string
  onChange: (value: string) => void
  workspaceId?: string
}

/** The caret and `{{` trigger behind a connector key field. Only secret names are ever read here. */
export function useConnectorApiKeyField({
  value,
  onChange,
  workspaceId,
}: ConnectorApiKeyFieldOptions) {
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [showSecrets, setShowSecrets] = useState(false)
  const availableEnvVars = useAvailableEnvVarKeys(workspaceId, { enabled: isFocused })
  const trigger = checkEnvVarTrigger(value, cursorPosition)
  return {
    availableEnvVars: availableEnvVars ?? NO_ENV_VARS,
    closeSuggestions: () => setShowSecrets(false),
    cursorPosition,
    inputRef,
    isFocused,
    overlayRef,
    /** A typed edit, which reads the caret the browser just moved. */
    handleChange: (next: string) => {
      onChange(next)
      setCursorPosition(inputRef.current?.selectionStart ?? next.length)
      setShowSecrets(true)
    },
    handleSelect: (selectionStart: number | null) =>
      setCursorPosition(selectionStart ?? value.length),
    handleFocus: () => setIsFocused(true),
    handleBlur: () => setIsFocused(false),
    handleScroll: (scrollLeft: number) => {
      if (overlayRef.current) {
        overlayRef.current.style.transform = `translateX(-${scrollLeft}px)`
      }
    },
    /** Pins the highlight to wherever the input had already scrolled when it mounts. */
    attachOverlay: (element: HTMLDivElement | null) => {
      overlayRef.current = element
      if (element) {
        element.style.transform = `translateX(-${inputRef.current?.scrollLeft ?? 0}px)`
      }
    },
    /** Inserts a chosen reference and restores the caret after React writes the new value. */
    handleSuggestion: (next: string, cursor: number) => {
      onChange(next)
      setCursorPosition(cursor)
      setShowSecrets(false)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.setSelectionRange(cursor, cursor)
      })
    },
    searchTerm: trigger.searchTerm,
    suggestionsVisible: showSecrets && trigger.show,
  }
}
