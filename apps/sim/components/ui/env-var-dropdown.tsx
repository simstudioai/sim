import type React from 'react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useEnvironmentStore } from '@/stores/settings/environment/store'

interface EnvVarDropdownProps {
  visible: boolean
  onSelect: (newValue: string) => void
  searchTerm?: string
  className?: string
  inputValue: string
  cursorPosition: number
  onClose?: () => void
  style?: React.CSSProperties
  workspaceId?: string
  maxHeight?: string
}

interface EnvVarGroup {
  label: string
  variables: string[]
}

export const EnvVarDropdown: React.FC<EnvVarDropdownProps> = ({
  visible,
  onSelect,
  searchTerm = '',
  className,
  inputValue,
  cursorPosition,
  onClose,
  style,
  workspaceId,
  maxHeight = 'none',
}) => {
  const loadWorkspaceEnvironment = useEnvironmentStore((state) => state.loadWorkspaceEnvironment)
  const userEnvVars = useEnvironmentStore((state) => Object.keys(state.variables))
  const [workspaceEnvData, setWorkspaceEnvData] = useState<{
    workspace: Record<string, string>
    personal: Record<string, string>
    conflicts: string[]
  }>({ workspace: {}, personal: {}, conflicts: [] })
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    if (workspaceId && visible) {
      loadWorkspaceEnvironment(workspaceId).then((data) => {
        setWorkspaceEnvData(data)
      })
    }
  }, [workspaceId, visible, loadWorkspaceEnvironment])

  const envVarGroups: EnvVarGroup[] = []

  if (workspaceId) {
    const workspaceVars = Object.keys(workspaceEnvData.workspace)
    const personalVars = Object.keys(workspaceEnvData.personal)

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

  useEffect(() => {
    setSelectedIndex(0)
  }, [searchTerm])

  const handleEnvVarSelect = (envVar: string) => {
    const textBeforeCursor = inputValue.slice(0, cursorPosition)
    const textAfterCursor = inputValue.slice(cursorPosition)

    const lastOpenBraces = textBeforeCursor.lastIndexOf('{{')

    const isStandardEnvVarContext = lastOpenBraces !== -1

    if (isStandardEnvVarContext) {
      const startText = textBeforeCursor.slice(0, lastOpenBraces)

      const closeIndex = textAfterCursor.indexOf('}}')
      const endText = closeIndex !== -1 ? textAfterCursor.slice(closeIndex + 2) : textAfterCursor

      const newValue = `${startText}{{${envVar}}}${endText}`
      onSelect(newValue)
    } else {
      if (inputValue.trim() !== '') {
        onSelect(`{{${envVar}}}`)
      } else {
        onSelect(`{{${envVar}}}`)
      }
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
            e.preventDefault()
            e.stopPropagation()
            handleEnvVarSelect(filteredEnvVars[selectedIndex])
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

  if (!visible) return null

  return (
    <div
      className={cn(
        'absolute z-[9999] mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md',
        className
      )}
      style={style}
    >
      {filteredEnvVars.length === 0 ? (
        <div className='px-3 py-2 text-muted-foreground text-sm'>
          No matching environment variables
        </div>
      ) : (
        <div
          className={cn('py-1', maxHeight !== 'none' && 'allow-scroll max-h-48 overflow-y-auto')}
          style={{
            scrollbarWidth: maxHeight !== 'none' ? 'thin' : undefined,
          }}
        >
          {filteredGroups.map((group) => (
            <div key={group.label}>
              {workspaceId && (
                <div className='border-border/50 border-b px-3 py-1 font-medium text-muted-foreground/70 text-xs uppercase tracking-wide'>
                  {group.label}
                </div>
              )}
              {group.variables.map((envVar) => {
                const globalIndex = filteredEnvVars.indexOf(envVar)
                return (
                  <button
                    key={`${group.label}-${envVar}`}
                    data-env-var-index={globalIndex}
                    className={cn(
                      'w-full px-3 py-1.5 text-left text-sm',
                      'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                      globalIndex === selectedIndex && 'bg-accent text-accent-foreground'
                    )}
                    onMouseEnter={() => setSelectedIndex(globalIndex)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleEnvVarSelect(envVar)
                    }}
                  >
                    {envVar}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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
