import { useEffect, useState } from 'react'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverSection,
} from '@/components/emcn'
import { cn } from '@/lib/utils'
import { useEnvironmentStore } from '@/stores/settings/environment/store'

/**
 * Props for the EnvVarDropdown component
 */
interface EnvVarDropdownProps {
  /** Whether the dropdown is visible */
  visible: boolean
  /** Callback when an environment variable is selected */
  onSelect: (newValue: string) => void
  /** Search term to filter environment variables */
  searchTerm?: string
  /** Additional CSS class names */
  className?: string
  /** Current value of the input field */
  inputValue: string
  /** Current cursor position in the input */
  cursorPosition: number
  /** Callback when the dropdown should close */
  onClose?: () => void
  /** Custom styles for positioning */
  style?: React.CSSProperties
  /** Workspace ID for loading workspace-specific environment variables */
  workspaceId?: string
  /** Maximum height for the dropdown */
  maxHeight?: string
  /** Reference to the input element for caret positioning */
  inputRef?: React.RefObject<HTMLTextAreaElement | HTMLInputElement>
}

/**
 * Environment variable group for organizing variables by scope
 */
interface EnvVarGroup {
  label: string
  variables: string[]
}

/**
 * Calculates the viewport position of the caret in a textarea/input
 */
const getCaretViewportPosition = (
  element: HTMLTextAreaElement | HTMLInputElement,
  caretPosition: number,
  text: string
) => {
  const elementRect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)

  const mirrorDiv = document.createElement('div')
  mirrorDiv.style.position = 'absolute'
  mirrorDiv.style.visibility = 'hidden'
  mirrorDiv.style.whiteSpace = 'pre-wrap'
  mirrorDiv.style.wordWrap = 'break-word'
  mirrorDiv.style.font = style.font
  mirrorDiv.style.padding = style.padding
  mirrorDiv.style.border = style.border
  mirrorDiv.style.width = style.width
  mirrorDiv.style.lineHeight = style.lineHeight
  mirrorDiv.style.boxSizing = style.boxSizing
  mirrorDiv.style.letterSpacing = style.letterSpacing
  mirrorDiv.style.textTransform = style.textTransform
  mirrorDiv.style.textIndent = style.textIndent
  mirrorDiv.style.textAlign = style.textAlign

  mirrorDiv.textContent = text.substring(0, caretPosition)

  const caretMarker = document.createElement('span')
  caretMarker.style.display = 'inline-block'
  caretMarker.style.width = '0px'
  caretMarker.style.padding = '0'
  caretMarker.style.border = '0'
  mirrorDiv.appendChild(caretMarker)

  document.body.appendChild(mirrorDiv)
  const markerRect = caretMarker.getBoundingClientRect()
  const mirrorRect = mirrorDiv.getBoundingClientRect()
  document.body.removeChild(mirrorDiv)

  const leftOffset = markerRect.left - mirrorRect.left - element.scrollLeft
  const topOffset = markerRect.top - mirrorRect.top - element.scrollTop

  return {
    left: elementRect.left + leftOffset,
    top: elementRect.top + topOffset,
  }
}

/**
 * EnvVarDropdown component that displays available environment variables
 * for selection in input fields. Uses the Popover component system for consistent styling.
 */
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
  inputRef,
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

  // Calculate caret position for proper anchoring
  const inputElement = inputRef?.current
  let caretViewport = { left: 0, top: 0 }
  let side: 'top' | 'bottom' = 'bottom'

  if (inputElement) {
    caretViewport = getCaretViewportPosition(inputElement, cursorPosition, inputValue)

    // Decide preferred side based on available space
    const margin = 8
    const spaceAbove = caretViewport.top - margin
    const spaceBelow = window.innerHeight - caretViewport.top - margin
    side = spaceBelow >= spaceAbove ? 'bottom' : 'top'
  }

  return (
    <Popover open={visible} onOpenChange={(open) => !open && onClose?.()}>
      <PopoverAnchor asChild>
        <div
          className={cn('pointer-events-none', className)}
          style={{
            ...style,
            position: inputElement ? 'fixed' : 'absolute',
            top: inputElement ? `${caretViewport.top}px` : style?.top,
            left: inputElement ? `${caretViewport.left}px` : style?.left,
            width: '1px',
            height: '1px',
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        maxHeight={maxHeight !== 'none' ? 192 : 400}
        className='min-w-[280px]'
        side={side}
        align='start'
        collisionPadding={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {filteredEnvVars.length === 0 ? (
          <div className='px-[6px] py-[8px] text-[12px] text-[var(--white)]/60'>
            No matching environment variables
          </div>
        ) : (
          <PopoverScrollArea>
            {filteredGroups.map((group) => (
              <div key={group.label}>
                {workspaceId && <PopoverSection>{group.label}</PopoverSection>}
                {group.variables.map((envVar) => {
                  const globalIndex = filteredEnvVars.indexOf(envVar)
                  return (
                    <PopoverItem
                      key={`${group.label}-${envVar}`}
                      data-env-var-index={globalIndex}
                      active={globalIndex === selectedIndex}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleEnvVarSelect(envVar)
                      }}
                    >
                      {envVar}
                    </PopoverItem>
                  )
                })}
              </div>
            ))}
          </PopoverScrollArea>
        )}
      </PopoverContent>
    </Popover>
  )
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
