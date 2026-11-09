import { useEffect, useState } from 'react'
import { writePendingCredentialCreateRequest } from '@/lib/credentials/client-state'
import { WORKSPACE_SETTINGS_PATH, workspacePath } from '@/lib/navigation/paths'
import { usePersonalEnvironment, useWorkspaceEnvironment } from '@/hooks/queries/environment'

/** One scope of secret names offered after `{{`: the workspace's or the viewer's own. */
interface EnvVarGroup {
  label: 'Workspace' | 'Personal'
  variables: string[]
}

interface EnvVarSuggestionsOptions {
  visible: boolean
  /** Receives the field's whole new text with the chosen `{{SECRET}}` in place. */
  onSelect: (newValue: string, newCursorPosition: number) => void
  searchTerm?: string
  inputValue: string
  cursorPosition: number
  onClose?: () => void
  workspaceId?: string
}

/**
 * The secret names matching a `{{` trigger, grouped by workspace and personal scope, with the
 * keyboard selection the field keeps while it holds focus (arrows, Enter, Tab and Escape are read
 * globally) and how a chosen name is written into the field's text. "Create Secret" queues the
 * typed name for the workspace Secrets settings, which live in the main app, and opens them there.
 */
export function useEnvVarSuggestions({
  visible,
  onSelect,
  searchTerm = '',
  inputValue,
  cursorPosition,
  onClose,
  workspaceId,
}: EnvVarSuggestionsOptions) {
  const { data: personalEnv = {} } = usePersonalEnvironment()
  const { data: workspaceEnvData } = useWorkspaceEnvironment(workspaceId ?? '')

  const [selectedIndex, setSelectedIndex] = useState(0)
  const [indexedSearchTerm, setIndexedSearchTerm] = useState(searchTerm)
  if (searchTerm !== indexedSearchTerm) {
    setIndexedSearchTerm(searchTerm)
    setSelectedIndex(0)
  }

  const envVarGroups: EnvVarGroup[] = []
  if (workspaceId && workspaceEnvData) {
    envVarGroups.push({
      label: 'Workspace',
      variables: Object.keys(workspaceEnvData.workspace ?? {}),
    })
    envVarGroups.push({
      label: 'Personal',
      variables: Object.keys(workspaceEnvData.personal ?? {}),
    })
  } else {
    const userEnvVars = Object.keys(personalEnv)
    if (userEnvVars.length > 0) envVarGroups.push({ label: 'Personal', variables: userEnvVars })
  }

  const query = searchTerm.toLowerCase()
  const filteredGroups = envVarGroups
    .map((group) => ({
      ...group,
      variables: group.variables.filter((envVar) => envVar.toLowerCase().includes(query)),
    }))
    .filter((group) => group.variables.length > 0)
  const filteredEnvVars = filteredGroups.flatMap((group) => group.variables)

  const openEnvironmentSettings = () => {
    if (workspaceId) {
      writePendingCredentialCreateRequest({
        workspaceId,
        type: 'env_personal',
        envKey: searchTerm.trim(),
        requestedAt: Date.now(),
      })
    }
    const settingsHref = workspaceId
      ? workspacePath(workspaceId, 'settings/secrets')
      : WORKSPACE_SETTINGS_PATH
    window.open(settingsHref, '_blank', 'noopener,noreferrer')
    onClose?.()
  }

  const handleEnvVarSelect = (envVar: string) => {
    const textBeforeCursor = inputValue.slice(0, cursorPosition)
    const textAfterCursor = inputValue.slice(cursorPosition)
    const lastOpenBraces = textBeforeCursor.lastIndexOf('{{')
    const tagLength = envVar.length + 4

    if (lastOpenBraces !== -1) {
      const startText = textBeforeCursor.slice(0, lastOpenBraces)
      const closeIndex = textAfterCursor.indexOf('}}')
      const endText = closeIndex !== -1 ? textAfterCursor.slice(closeIndex + 2) : textAfterCursor
      onSelect(`${startText}{{${envVar}}}${endText}`, lastOpenBraces + tagLength)
    } else {
      onSelect(`{{${envVar}}}`, tagLength)
    }
    onClose?.()
  }

  useEffect(() => {
    if (!visible) return
    const handleKeyboardEvent = (event: KeyboardEvent) => {
      if (!filteredEnvVars.length) return
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          event.stopPropagation()
          setSelectedIndex((prev) => Math.min(prev + 1, filteredEnvVars.length - 1))
          break
        case 'ArrowUp':
          event.preventDefault()
          event.stopPropagation()
          setSelectedIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'Enter':
        case 'Tab': {
          if (event.key === 'Tab' && event.shiftKey) break
          const envVar = filteredEnvVars[selectedIndex]
          if (envVar) {
            event.preventDefault()
            event.stopPropagation()
            handleEnvVarSelect(envVar)
          }
          break
        }
        case 'Escape':
          event.preventDefault()
          event.stopPropagation()
          onClose?.()
          break
      }
    }
    window.addEventListener('keydown', handleKeyboardEvent, true)
    return () => window.removeEventListener('keydown', handleKeyboardEvent, true)
  })

  return {
    filteredEnvVars,
    filteredGroups,
    handleEnvVarSelect,
    openEnvironmentSettings,
    selectedIndex,
    setSelectedIndex,
  }
}

/**
 * Whether the text before the caret opens a `{{` secret reference, and the partial name typed after
 * it, which filters the suggestions.
 */
export function checkEnvVarTrigger(
  text: string,
  cursorPosition: number
): { show: boolean; searchTerm: string } {
  if (cursorPosition < 2) return { show: false, searchTerm: '' }
  const match = text.slice(0, cursorPosition).match(/\{\{(\w*)$/)
  return match ? { show: true, searchTerm: match[1] } : { show: false, searchTerm: '' }
}
