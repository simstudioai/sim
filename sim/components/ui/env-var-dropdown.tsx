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
}) => {
  const envVars = useEnvironmentStore((state) => Object.keys(state.variables))
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Filter env vars based on search term
  const filteredEnvVars = envVars.filter((envVar) =>
    envVar.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Reset selection when filtered results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchTerm])

  // Handle environment variable selection
  const handleEnvVarSelect = (envVar: string) => {
    const textBeforeCursor = inputValue.slice(0, cursorPosition)
    const textAfterCursor = inputValue.slice(cursorPosition)

    // Find the start of the env var syntax (last '{{' before cursor)
    const lastOpenBraces = textBeforeCursor.lastIndexOf('{{')

    // Check if we're in a standard env var context (with braces) or direct typing mode
    const isStandardEnvVarContext = lastOpenBraces !== -1

    if (isStandardEnvVarContext) {
      // Standard behavior with {{ }} syntax
      const startText = textBeforeCursor.slice(0, lastOpenBraces)

      // Find the end of any existing env var syntax after cursor
      const closeIndex = textAfterCursor.indexOf('}}')
      const endText = closeIndex !== -1 ? textAfterCursor.slice(closeIndex + 2) : textAfterCursor

      // Construct the new value with proper env var syntax
      const newValue = startText + '{{' + envVar + '}}' + endText
      onSelect(newValue)
    } else {
      // For direct typing mode (API key fields), check if we need to replace existing text
      // This handles the case where user has already typed part of a variable name
      if (inputValue.trim() !== '') {
        // Replace the entire input with the selected env var
        onSelect('{{' + envVar + '}}')
      } else {
        // Empty input, just insert the env var
        onSelect('{{' + envVar + '}}')
      }
    }

    onClose?.()
  }

  // Add and remove keyboard event listener
  useEffect(() => {
    if (visible) {
      const handleKeyboardEvent = (e: KeyboardEvent) => {
        if (!filteredEnvVars.length) return

        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault()
            e.stopPropagation()
            setSelectedIndex((prev) => (prev < filteredEnvVars.length - 1 ? prev + 1 : prev))
            break
          case 'ArrowUp':
            e.preventDefault()
            e.stopPropagation()
            setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
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
        'absolute z-[9999] w-full mt-1 overflow-hidden bg-popover rounded-md border shadow-md',
        className
      )}
      style={style}
    >
      {filteredEnvVars.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          No matching environment variables
        </div>
      ) : (
        <div className="py-1">
          {filteredEnvVars.map((envVar, index) => (
            <button
              key={envVar}
              className={cn(
                'w-full px-3 py-1.5 text-sm text-left',
                'hover:bg-accent hover:text-accent-foreground',
                'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                index === selectedIndex && 'bg-accent text-accent-foreground'
              )}
              onMouseEnter={() => setSelectedIndex(index)}
              onMouseDown={(e) => {
                e.preventDefault() // Prevent input blur
                handleEnvVarSelect(envVar)
              }}
            >
              {envVar}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Helper function to check for '{{' trigger and get search term
export const checkEnvVarTrigger = (
  text: string,
  cursorPosition: number
): { show: boolean; searchTerm: string } => {
  if (cursorPosition >= 2) {
    const textBeforeCursor = text.slice(0, cursorPosition)
    // Look for {{ pattern followed by optional text
    const match = textBeforeCursor.match(/\{\{(\w*)$/)
    if (match) {
      return { show: true, searchTerm: match[1] }
    }

    // Also check for exact {{ without any text after it
    // This ensures all env vars show when user just types {{
    if (textBeforeCursor.endsWith('{{')) {
      return { show: true, searchTerm: '' }
    }
  }
  return { show: false, searchTerm: '' }
}
