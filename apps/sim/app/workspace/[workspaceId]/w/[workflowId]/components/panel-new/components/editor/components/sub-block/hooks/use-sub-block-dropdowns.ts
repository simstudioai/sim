import { useCallback, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { checkEnvVarTrigger } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/env-var-dropdown'
import { checkTagTrigger } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import type { SubBlockConfig } from '@/blocks/types'
import { useTagSelection } from '@/hooks/use-tag-selection'

/**
 * Options for the useSubBlockDropdowns hook.
 */
export interface UseSubBlockDropdownsOptions {
  /** Unique identifier for the block */
  blockId: string
  /** Unique identifier for the sub-block */
  subBlockId: string
  /** Configuration object for the sub-block */
  config?: SubBlockConfig
  /** Whether component is in preview mode */
  isPreview?: boolean
  /** Whether the input is disabled */
  disabled?: boolean
  /** Callback when value changes (for controlled components) */
  onChange?: (value: string) => void
}

/**
 * Return value for the useSubBlockDropdowns hook.
 */
export interface UseSubBlockDropdownsResult {
  /** Ref to the input element for dropdown positioning */
  inputRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>
  /** Whether env vars dropdown is visible */
  showEnvVars: boolean
  /** Whether tags dropdown is visible */
  showTags: boolean
  /** Current search term for env vars */
  searchTerm: string
  /** Current cursor position in the input */
  cursorPosition: number
  /** Active source block id for tag filtering */
  activeSourceBlockId: string | null
  /** Current input value */
  inputValue: string
  /** Whether any dropdown is active */
  hasActiveDropdown: boolean
  /** Workspace id for env var scoping */
  workspaceId: string
  /** Update the input value */
  setInputValue: (value: string) => void
  /** Handle input changes and check for dropdown triggers */
  handleInputChange: (value: string, cursorPosition: number) => void
  /** Handle key down events for dropdown control */
  handleKeyDown: (e: React.KeyboardEvent) => void
  /** Handle drag and drop for connection blocks */
  handleDrop: (
    e: React.DragEvent,
    currentValue: string,
    onValueChange: (value: string) => void
  ) => void
  /** Handle drag over events */
  handleDragOver: (e: React.DragEvent) => void
  /** Handle tag selection */
  handleTagSelect: (newValue: string, onChange?: (value: string) => void) => void
  /** Handle env var selection */
  handleEnvVarSelect: (newValue: string, onChange?: (value: string) => void) => void
  /** Handle focus events */
  handleFocus: () => void
  /** Manually control env vars visibility */
  setShowEnvVars: (show: boolean) => void
  /** Manually control tags visibility */
  setShowTags: (show: boolean) => void
  /** Manually set search term */
  setSearchTerm: (term: string) => void
  /** Manually set active source block id */
  setActiveSourceBlockId: (id: string | null) => void
}

/**
 * Hook that manages tag and env-var dropdown state and behavior.
 *
 * @remarks
 * This hook provides all the necessary state and handlers for implementing
 * dropdown functionality in sub-block inputs. It handles:
 * - Trigger detection (< for tags, {{ for env vars)
 * - Drag and drop for connection blocks
 * - Keyboard navigation (Escape to close)
 * - Value synchronization with store or controlled props
 *
 * @example
 * ```tsx
 * const dropdowns = useSubBlockDropdowns({
 *   blockId: 'block-1',
 *   subBlockId: 'input-1',
 *   config: subBlockConfig,
 * })
 *
 * // Use in your component
 * <input
 *   ref={dropdowns.inputRef}
 *   value={dropdowns.inputValue}
 *   onChange={(e) => dropdowns.handleInputChange(e.target.value, e.target.selectionStart || 0)}
 *   onKeyDown={dropdowns.handleKeyDown}
 * />
 * ```
 */
export function useSubBlockDropdowns(
  options: UseSubBlockDropdownsOptions
): UseSubBlockDropdownsResult {
  const { blockId, subBlockId, config, isPreview = false, disabled = false, onChange } = options

  const params = useParams()
  const workspaceId = params.workspaceId as string

  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')

  const emitTagSelection = useTagSelection(blockId, subBlockId)

  const hasActiveDropdown = showEnvVars || showTags

  /**
   * Handles input changes and checks for dropdown triggers.
   */
  const handleInputChange = useCallback((value: string, newCursorPosition: number) => {
    setInputValue(value)
    setCursorPosition(newCursorPosition)

    // Check for environment variables trigger
    const envVarTrigger = checkEnvVarTrigger(value, newCursorPosition)
    setShowEnvVars(envVarTrigger.show)
    setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')

    // Check for tag trigger
    const tagTrigger = checkTagTrigger(value, newCursorPosition)
    setShowTags(tagTrigger.show)
  }, [])

  /**
   * Handles key down events for dropdown control.
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowEnvVars(false)
      setShowTags(false)
    }
  }, [])

  /**
   * Handles drag and drop for connection blocks.
   */
  const handleDrop = useCallback(
    (e: React.DragEvent, currentValue: string, onValueChange: (value: string) => void) => {
      if (config?.connectionDroppable === false) return
      e.preventDefault()

      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'))
        if (data.type !== 'connectionBlock') return

        const dropPosition = inputRef.current?.selectionStart ?? currentValue.length
        const newValue = `${currentValue.slice(0, dropPosition)}<${currentValue.slice(dropPosition)}`

        inputRef.current?.focus()

        Promise.resolve().then(() => {
          onValueChange(newValue)
          setInputValue(newValue)
          setCursorPosition(dropPosition + 1)
          setShowTags(true)

          if (data.connectionData?.sourceBlockId) {
            setActiveSourceBlockId(data.connectionData.sourceBlockId)
          }

          setTimeout(() => {
            if (inputRef.current) {
              inputRef.current.selectionStart = dropPosition + 1
              inputRef.current.selectionEnd = dropPosition + 1
            }
          }, 0)
        })
      } catch (error) {
        // Silently handle invalid drop data
      }
    },
    [config?.connectionDroppable]
  )

  /**
   * Handles drag over events.
   */
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (config?.connectionDroppable === false) return
      e.preventDefault()
    },
    [config?.connectionDroppable]
  )

  /**
   * Handles tag selection.
   */
  const handleTagSelect = useCallback(
    (newValue: string, onChangeOverride?: (value: string) => void) => {
      if (onChangeOverride) {
        onChangeOverride(newValue)
      } else if (onChange) {
        onChange(newValue)
      } else if (!isPreview && !disabled) {
        emitTagSelection(newValue)
      }
      setInputValue(newValue)
    },
    [isPreview, disabled, onChange, emitTagSelection]
  )

  /**
   * Handles env var selection.
   */
  const handleEnvVarSelect = useCallback(
    (newValue: string, onChangeOverride?: (value: string) => void) => {
      if (onChangeOverride) {
        onChangeOverride(newValue)
      } else if (onChange) {
        onChange(newValue)
      } else if (!isPreview && !disabled) {
        emitTagSelection(newValue)
      }
      setInputValue(newValue)
    },
    [isPreview, disabled, onChange, emitTagSelection]
  )

  /**
   * Closes dropdowns on focus.
   */
  const handleFocus = useCallback(() => {
    setShowEnvVars(false)
    setShowTags(false)
    setSearchTerm('')
  }, [])

  return {
    inputRef,
    showEnvVars,
    showTags,
    searchTerm,
    cursorPosition,
    activeSourceBlockId,
    inputValue,
    hasActiveDropdown,
    workspaceId,
    setInputValue,
    handleInputChange,
    handleKeyDown,
    handleDrop,
    handleDragOver,
    handleTagSelect,
    handleEnvVarSelect,
    handleFocus,
    setShowEnvVars,
    setShowTags,
    setSearchTerm,
    setActiveSourceBlockId,
  }
}
