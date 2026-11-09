import {
  cn,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverSection,
} from '@sim/emcn-legacy'
import { Plus } from '@sim/emcn-legacy/icons'
import { useEnvVarSuggestions } from '@/hooks/use-env-var-suggestions'

/**
 * Props for the EnvVarDropdown component
 */
interface EnvVarDropdownProps {
  /** Whether the dropdown is visible */
  visible: boolean
  /** Callback when an environment variable is selected */
  onSelect: (newValue: string, newCursorPosition: number) => void
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
  style?: Pick<React.CSSProperties, 'top' | 'left' | 'zIndex'>
  /** Workspace ID for loading workspace-specific environment variables */
  workspaceId?: string
  /** Maximum height for the dropdown */
  maxHeight?: string
  /** Reference to the input element for caret positioning */
  inputRef?: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>
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
  const {
    filteredEnvVars,
    filteredGroups,
    handleEnvVarSelect,
    openEnvironmentSettings,
    selectedIndex,
    setSelectedIndex,
  } = useEnvVarSuggestions({
    visible,
    onSelect,
    searchTerm,
    inputValue,
    cursorPosition,
    onClose,
    workspaceId,
  })

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
    <Popover open={visible} onOpenChange={(open) => !open && onClose?.()} colorScheme='inverted'>
      <PopoverAnchor asChild>
        <div
          className={cn('pointer-events-none', className)}
          style={{
            zIndex: style?.zIndex,
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
        style={{ zIndex: 100000000 }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {filteredEnvVars.length === 0 ? (
          <PopoverScrollArea>
            <PopoverItem
              onMouseDown={(e) => {
                e.preventDefault()
                openEnvironmentSettings()
              }}
            >
              <Plus className='size-3' />
              <span>Create Secret</span>
            </PopoverItem>
          </PopoverScrollArea>
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
