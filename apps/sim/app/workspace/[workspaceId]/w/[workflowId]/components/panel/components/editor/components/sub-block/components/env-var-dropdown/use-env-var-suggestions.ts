import { useCallback, useEffect, useState } from 'react'
import { writePendingCredentialCreateRequest } from '@/lib/credentials/client-state'
import type { WorkspaceEnvironmentData } from '@/lib/environment/api'
import { usePersonalEnvironment, useWorkspaceEnvironment } from '@/hooks/queries/environment'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

/**
 * Environment variable group for organizing variables by scope
 */
interface EnvVarGroup {
  label: string
  variables: string[]
}

interface EnvVarSuggestionsOptions {
  visible: boolean
  onSelect: (newValue: string, newCursorPosition: number) => void
  searchTerm?: string
  inputValue: string
  cursorPosition: number
  onClose?: () => void
  workspaceId?: string
}

/** The secret names matching a `{{` trigger, their keyboard selection, and how one is inserted. */
export function useEnvVarSuggestions({
  visible,
  onSelect,
  searchTerm = '',
  inputValue,
  cursorPosition,
  onClose,
  workspaceId,
}: EnvVarSuggestionsOptions) {
  const { navigateToSettings } = useSettingsNavigation()

  const { data: personalEnv = {} } = usePersonalEnvironment()
  const { data: workspaceEnvData } = useWorkspaceEnvironment(workspaceId || '', {
    select: useCallback(
      (data: WorkspaceEnvironmentData): WorkspaceEnvironmentData => ({
        workspace: data.workspace || {},
        personal: data.personal || {},
        conflicts: data.conflicts || [],
      }),
      []
    ),
  })

  const userEnvVars = Object.keys(personalEnv)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [indexedSearchTerm, setIndexedSearchTerm] = useState(searchTerm)
  if (searchTerm !== indexedSearchTerm) {
    setIndexedSearchTerm(searchTerm)
    setSelectedIndex(0)
  }

  const envVarGroups: EnvVarGroup[] = []

  if (workspaceId && workspaceEnvData) {
    const workspaceVars = Object.keys(workspaceEnvData?.workspace || {})
    const personalVars = Object.keys(workspaceEnvData?.personal || {})

    envVarGroups.push({ label: 'Workspace', variables: workspaceVars })
    envVarGroups.push({ label: 'Personal', variables: personalVars })
  } else {
    if (userEnvVars.length > 0) {
      envVarGroups.push({ label: 'Personal', variables: userEnvVars })
    }
  }

  const allEnvVars = envVarGroups.flatMap((group) => group.variables)

  const filteredEnvVars = allEnvVars.filter((envVar) =>
    envVar.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const filteredGroups = envVarGroups
    .map((group) => ({
      ...group,
      variables: group.variables.filter((envVar) =>
        envVar.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    }))
    .filter((group) => group.variables.length > 0)

  const openEnvironmentSettings = () => {
    if (workspaceId) {
      writePendingCredentialCreateRequest({
        workspaceId,
        type: 'env_personal',
        envKey: searchTerm.trim(),
        requestedAt: Date.now(),
      })
    }
    navigateToSettings({ section: 'secrets' })
    onClose?.()
  }

  const handleEnvVarSelect = (envVar: string) => {
    const textBeforeCursor = inputValue.slice(0, cursorPosition)
    const textAfterCursor = inputValue.slice(cursorPosition)

    const lastOpenBraces = textBeforeCursor.lastIndexOf('{{')

    const isStandardEnvVarContext = lastOpenBraces !== -1

    const tagLength = 2 + envVar.length + 2

    if (isStandardEnvVarContext) {
      const startText = textBeforeCursor.slice(0, lastOpenBraces)

      const closeIndex = textAfterCursor.indexOf('}}')
      const endText = closeIndex !== -1 ? textAfterCursor.slice(closeIndex + 2) : textAfterCursor

      const newValue = `${startText}{{${envVar}}}${endText}`
      onSelect(newValue, lastOpenBraces + tagLength)
    } else {
      const newValue = `{{${envVar}}}`
      onSelect(newValue, tagLength)
    }

    onClose?.()
  }

  useEffect(() => {
    if (visible) {
      const handleKeyboardEvent = (e: KeyboardEvent) => {
        if (!filteredEnvVars.length) return

        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault()
            e.stopPropagation()
            setSelectedIndex((prev) => {
              const newIndex = prev < filteredEnvVars.length - 1 ? prev + 1 : prev
              setTimeout(() => {
                const selectedElement = document.querySelector(`[data-env-var-index="${newIndex}"]`)
                if (selectedElement) {
                  selectedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                }
              }, 0)
              return newIndex
            })
            break
          case 'ArrowUp':
            e.preventDefault()
            e.stopPropagation()
            setSelectedIndex((prev) => {
              const newIndex = prev > 0 ? prev - 1 : prev
              setTimeout(() => {
                const selectedElement = document.querySelector(`[data-env-var-index="${newIndex}"]`)
                if (selectedElement) {
                  selectedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                }
              }, 0)
              return newIndex
            })
            break
          case 'Enter':
          case 'Tab':
            if (e.key === 'Tab' && e.shiftKey) break
            if (filteredEnvVars[selectedIndex]) {
              e.preventDefault()
              e.stopPropagation()
              handleEnvVarSelect(filteredEnvVars[selectedIndex])
            }
            break
          case 'Escape':
            e.preventDefault()
            e.stopPropagation()
            onClose?.()
            break
        }
      }

      window.addEventListener('keydown', handleKeyboardEvent, true)
      return () => window.removeEventListener('keydown', handleKeyboardEvent, true)
    }
  }, [visible, selectedIndex, filteredEnvVars])

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
 * Checks if the environment variable trigger ({{) should show the dropdown
 * @param text - The full text content
 * @param cursorPosition - Current cursor position
 * @returns Object indicating whether to show the dropdown and the current search term
 */
export const checkEnvVarTrigger = (
  text: string,
  cursorPosition: number
): { show: boolean; searchTerm: string } => {
  if (cursorPosition >= 2) {
    const textBeforeCursor = text.slice(0, cursorPosition)
    const match = textBeforeCursor.match(/\{\{(\w*)$/)
    if (match) {
      return { show: true, searchTerm: match[1] }
    }

    if (textBeforeCursor.endsWith('{{')) {
      return { show: true, searchTerm: '' }
    }
  }
  return { show: false, searchTerm: '' }
}
