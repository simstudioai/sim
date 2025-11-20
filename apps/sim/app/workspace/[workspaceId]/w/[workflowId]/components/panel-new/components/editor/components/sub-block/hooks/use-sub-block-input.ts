import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { checkEnvVarTrigger } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/env-var-dropdown'
import { checkTagTrigger } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { useTagSelection } from '@/hooks/use-tag-selection'

const logger = createLogger('useSubBlockInput')

/**
 * Options for the useSubBlockInput hook.
 *
 * @remarks
 * This controller centralizes shared input behaviors for sub-block inputs:
 * typing, caret tracking, env-var/tag triggers, DnD for connections, escape handling,
 * preview/disabled/streaming guards, and store synchronization.
 */
export interface UseSubBlockInputOptions {
  /** Workflow block identifier. */
  blockId: string
  /** Sub-block identifier. */
  subBlockId: string
  /** Sub-block configuration. */
  config: SubBlockConfig
  /** Optional externally controlled value. */
  value?: string
  /** Optional change handler for controlled inputs. */
  onChange?: (value: string) => void
  /** Whether the view is in preview mode. */
  isPreview?: boolean
  /** Whether the input should be disabled. */
  disabled?: boolean
  /** When true, user edits are blocked and streaming content may be displayed. */
  isStreaming?: boolean
  /** Callback invoked when streaming finishes; used to persist store value. */
  onStreamingEnd?: () => void
  /** Optional preview value for read-only preview displays. */
  previewValue?: string | null
  /** Optional workspace id; if omitted, derived from route params. */
  workspaceId?: string
  /**
   * Optional callback to force/show the env var dropdown (e.g., API key fields).
   * Return { show: true, searchTerm?: string } to override defaults.
   * Called on 'change' (typing), 'focus', and 'deleteAll' (full selection delete/backspace).
   */
  shouldForceEnvDropdown?: (args: {
    value: string
    cursor: number
    event: 'change' | 'focus' | 'deleteAll'
  }) => { show: boolean; searchTerm?: string } | undefined
}

/**
 * Field-level state for array-based inputs
 */
export interface FieldState {
  cursorPosition: number
  showEnvVars: boolean
  showTags: boolean
  searchTerm: string
  activeSourceBlockId: string | null
}

/**
 * Return shape for the useSubBlockInput hook.
 */
export interface UseSubBlockInputResult {
  /** Unified ref for anchoring popovers and reading caret. */
  inputRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement>
  /** Current computed string value to render. */
  valueString: string
  /** Whether input interactions are disabled. */
  isDisabled: boolean
  /** Current caret position. */
  cursorPosition: number
  /** Whether env var dropdown should be visible. */
  showEnvVars: boolean
  /** Whether tag dropdown should be visible. */
  showTags: boolean
  /** Current env var search term. */
  searchTerm: string
  /** Active source block id for tag dropdown context. */
  activeSourceBlockId: string | null
  /** Handlers to attach to input-like components. */
  handlers: {
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => void
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void
    onDrop: (e: React.DragEvent<HTMLTextAreaElement | HTMLInputElement>) => void
    onDragOver: (e: React.DragEvent<HTMLTextAreaElement | HTMLInputElement>) => void
    onFocus: () => void
    onScroll?: (e: React.UIEvent<HTMLTextAreaElement>) => void
  }
  /** Workspace id for env var dropdown scoping. */
  workspaceId: string | undefined
  /** Imperative controls for popovers. */
  controls: {
    hideEnvVars: () => void
    hideTags: () => void
    setActiveSourceBlockId: (id: string | null) => void
  }
  /** Field-level helpers for array-based inputs */
  fieldHelpers: {
    /** Get state for a specific field */
    getFieldState: (fieldId: string) => FieldState
    /** Create handlers for a specific field in an array */
    createFieldHandlers: (
      fieldId: string,
      fieldValue: string,
      onFieldChange: (newValue: string) => void
    ) => {
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => void
      onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void
      onDrop: (e: React.DragEvent<HTMLTextAreaElement | HTMLInputElement>) => void
      onDragOver: (e: React.DragEvent<HTMLTextAreaElement | HTMLInputElement>) => void
    }
    /** Hide dropdowns for a specific field */
    hideFieldDropdowns: (fieldId: string) => void
    /** Create tag select handler for a field */
    createTagSelectHandler: (
      fieldId: string,
      fieldValue: string,
      onFieldChange: (newValue: string) => void
    ) => (newValue: string) => void
    /** Create env var select handler for a field */
    createEnvVarSelectHandler: (
      fieldId: string,
      fieldValue: string,
      onFieldChange: (newValue: string) => void
    ) => (newValue: string) => void
  }
}

/**
 * useSubBlockInput centralizes shared input behavior for workflow sub-block inputs.
 *
 * The hook is UI-agnostic and exposes refs, state, and event handlers needed by
 * headless wrappers or concrete input components. Popover rendering is intended
 * to be handled by a thin controller component using the returned state.
 */
export function useSubBlockInput(options: UseSubBlockInputOptions): UseSubBlockInputResult {
  const {
    blockId,
    subBlockId,
    config,
    value: propValue,
    onChange,
    isPreview = false,
    disabled = false,
    isStreaming = false,
    onStreamingEnd,
    previewValue,
    workspaceId: workspaceIdProp,
    shouldForceEnvDropdown,
  } = options

  const params = useParams()
  const workspaceId = (workspaceIdProp || (params?.workspaceId as string)) ?? undefined

  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId, false, {
    isStreaming,
    onStreamingEnd,
  })

  const emitTagSelection = useTagSelection(blockId, subBlockId)

  // Local content enables immediate UI updates and streaming text display
  const [localContent, setLocalContent] = useState<string>('')

  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)

  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null)

  // Compute the value to render
  const value = useMemo(() => {
    if (isStreaming) return localContent
    if (isPreview) return previewValue
    if (propValue !== undefined) return propValue
    return storeValue
  }, [isStreaming, localContent, isPreview, previewValue, propValue, storeValue])

  const valueString = useMemo(() => value?.toString?.() ?? '', [value])

  const baseValue = isPreview ? previewValue : propValue !== undefined ? propValue : storeValue

  // Sync local content with base value when not streaming
  useEffect(() => {
    if (!isStreaming) {
      const baseValueString = baseValue?.toString?.() ?? ''
      if (baseValueString !== localContent) {
        setLocalContent(baseValueString)
      }
    }
  }, [baseValue, isStreaming])

  // Update store during streaming (deferred persistence is handled by onStreamingEnd)
  useEffect(() => {
    if (isStreaming && localContent !== '' && !isPreview && !disabled) {
      setStoreValue(localContent)
    }
  }, [localContent, isStreaming, isPreview, disabled, setStoreValue])

  const isDisabled = isPreview || disabled

  // Handlers
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (isDisabled || isStreaming) return
      const newValue = e.target.value
      const newCursor = (e.target as HTMLTextAreaElement | HTMLInputElement).selectionStart ?? 0

      setLocalContent(newValue)
      if (onChange) {
        onChange(newValue)
      } else if (!isPreview) {
        setStoreValue(newValue)
      }

      setCursorPosition(newCursor)

      // Triggers
      const envVar = checkEnvVarTrigger(newValue, newCursor)
      let showEnv = envVar.show
      let nextSearch = envVar.show ? envVar.searchTerm : ''
      if (shouldForceEnvDropdown) {
        const forced = shouldForceEnvDropdown({
          value: newValue,
          cursor: newCursor,
          event: 'change',
        })
        if (forced?.show) {
          // Always allow the callback to show the dropdown, but
          // do not override the search term if the standard `{{` trigger is active.
          showEnv = true
          if (!envVar.show) {
            nextSearch = forced.searchTerm ?? newValue
          }
        }
      }
      setShowEnvVars(showEnv)
      setSearchTerm(showEnv ? nextSearch : '')

      const tag = checkTagTrigger(newValue, newCursor)
      setShowTags(tag.show)
    },
    [isDisabled, isStreaming, onChange, isPreview, setStoreValue, shouldForceEnvDropdown]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (e.key === 'Escape') {
        setShowEnvVars(false)
        setShowTags(false)
        setSearchTerm('')
      }
      if (isStreaming) {
        e.preventDefault()
      }
      // If Delete/Backspace with full selection, allow forcing env dropdown
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        shouldForceEnvDropdown &&
        inputRef.current
      ) {
        const el = inputRef.current as HTMLInputElement | HTMLTextAreaElement
        const val = el.value ?? valueString
        if (typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
          if (el.selectionStart === 0 && el.selectionEnd === val.length) {
            const forced = shouldForceEnvDropdown({
              value: val,
              cursor: 0,
              event: 'deleteAll',
            })
            if (forced?.show) {
              setTimeout(() => {
                setShowEnvVars(true)
                setSearchTerm(forced.searchTerm ?? '')
              }, 0)
            }
          }
        }
      }
    },
    [isStreaming, shouldForceEnvDropdown, valueString]
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (config?.connectionDroppable === false) return
      e.preventDefault()
    },
    [config?.connectionDroppable]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (config?.connectionDroppable === false) return
      e.preventDefault()
      try {
        const dataRaw = e.dataTransfer.getData('application/json')
        const data = dataRaw ? JSON.parse(dataRaw) : null
        if (!data || data.type !== 'connectionBlock') return

        const el = inputRef.current as HTMLTextAreaElement | HTMLInputElement | null
        const dropPos = el?.selectionStart ?? valueString.length
        const newValue = `${valueString.slice(0, dropPos)}<${valueString.slice(dropPos)}`

        if (el) el.focus()

        Promise.resolve().then(() => {
          setLocalContent(newValue)
          if (onChange) {
            onChange(newValue)
          } else if (!isPreview) {
            setStoreValue(newValue)
          }
          setCursorPosition(dropPos + 1)
          setShowTags(true)
          if (data.connectionData?.sourceBlockId) {
            setActiveSourceBlockId(data.connectionData.sourceBlockId)
          }
          setTimeout(() => {
            if (inputRef.current) {
              inputRef.current.selectionStart = dropPos + 1
              inputRef.current.selectionEnd = dropPos + 1
            }
          }, 0)
        })
      } catch (error) {
        logger.error('Failed to handle drop', { error })
      }
    },
    [config?.connectionDroppable, valueString, onChange, isPreview, setStoreValue]
  )

  const handleFocus = useCallback(() => {
    if (shouldForceEnvDropdown) {
      // Use a slight delay to ensure the input ref is populated
      setTimeout(() => {
        const forced = shouldForceEnvDropdown({
          value: (inputRef.current as any)?.value ?? valueString,
          cursor: (inputRef.current as any)?.selectionStart ?? valueString.length,
          event: 'focus',
        })
        if (forced?.show) {
          setShowEnvVars(true)
          setSearchTerm(forced.searchTerm ?? '')
        }
      }, 0)
    }
  }, [shouldForceEnvDropdown, valueString])

  const onScroll = useCallback((_: React.UIEvent<HTMLTextAreaElement>) => {
    // Intentionally empty; consumers may mirror scroll to overlays if needed
  }, [])

  // Helper to apply selected value coming from popovers
  const applySelectedValue = useCallback(
    (newValue: string, isTagSelection: boolean) => {
      if (onChange) {
        onChange(newValue)
      } else if (!isPreview) {
        if (isTagSelection) {
          emitTagSelection(newValue)
        } else {
          setStoreValue(newValue)
        }
      }
    },
    [onChange, isPreview, emitTagSelection, setStoreValue]
  )

  // Field-level state tracking for array-based inputs
  const [fieldStates, setFieldStates] = useState<Record<string, FieldState>>({})

  // Get field state with defaults
  const getFieldState = useCallback(
    (fieldId: string): FieldState => {
      return (
        fieldStates[fieldId] || {
          cursorPosition: 0,
          showEnvVars: false,
          showTags: false,
          searchTerm: '',
          activeSourceBlockId: null,
        }
      )
    },
    [fieldStates]
  )

  // Update field state
  const updateFieldState = useCallback((fieldId: string, updates: Partial<FieldState>) => {
    setFieldStates((prev) => ({
      ...prev,
      [fieldId]: { ...prev[fieldId], ...updates } as FieldState,
    }))
  }, [])

  // Create handlers for a specific field
  const createFieldHandlers = useCallback(
    (fieldId: string, fieldValue: string, onFieldChange: (newValue: string) => void) => {
      return {
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
          if (isDisabled || isStreaming) return
          const newValue = e.target.value
          const newCursor = e.target.selectionStart ?? 0

          onFieldChange(newValue)
          updateFieldState(fieldId, { cursorPosition: newCursor })

          // Check triggers
          const envVar = checkEnvVarTrigger(newValue, newCursor)
          const tag = checkTagTrigger(newValue, newCursor)

          updateFieldState(fieldId, {
            cursorPosition: newCursor,
            showEnvVars: envVar.show,
            searchTerm: envVar.show ? envVar.searchTerm : '',
            showTags: tag.show,
          })
        },
        onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
          if (e.key === 'Escape') {
            updateFieldState(fieldId, {
              showEnvVars: false,
              showTags: false,
              searchTerm: '',
            })
          }
          if (isStreaming) {
            e.preventDefault()
          }
        },
        onDrop: (e: React.DragEvent<HTMLTextAreaElement | HTMLInputElement>) => {
          if (config?.connectionDroppable === false) return
          e.preventDefault()
          try {
            const dataRaw = e.dataTransfer.getData('application/json')
            const data = dataRaw ? JSON.parse(dataRaw) : null
            if (!data || data.type !== 'connectionBlock') return

            const el = e.currentTarget
            const dropPos = el.selectionStart ?? fieldValue.length
            const newValue = `${fieldValue.slice(0, dropPos)}<${fieldValue.slice(dropPos)}`

            onFieldChange(newValue)
            updateFieldState(fieldId, {
              cursorPosition: dropPos + 1,
              showTags: true,
              activeSourceBlockId: data.connectionData?.sourceBlockId || null,
            })

            setTimeout(() => {
              el.focus()
              el.selectionStart = dropPos + 1
              el.selectionEnd = dropPos + 1
            }, 0)
          } catch (error) {
            logger.error('Failed to handle field drop', { error, fieldId })
          }
        },
        onDragOver: (e: React.DragEvent<HTMLTextAreaElement | HTMLInputElement>) => {
          if (config?.connectionDroppable === false) return
          e.preventDefault()
        },
      }
    },
    [isDisabled, isStreaming, config?.connectionDroppable, updateFieldState]
  )

  // Hide dropdowns for a field
  const hideFieldDropdowns = useCallback(
    (fieldId: string) => {
      updateFieldState(fieldId, {
        showEnvVars: false,
        showTags: false,
        searchTerm: '',
        activeSourceBlockId: null,
      })
    },
    [updateFieldState]
  )

  // Create tag select handler for a field
  const createTagSelectHandler = useCallback(
    (fieldId: string, fieldValue: string, onFieldChange: (newValue: string) => void) => {
      return (newValue: string) => {
        if (!isPreview && !disabled) {
          onFieldChange(newValue)
          hideFieldDropdowns(fieldId)
        }
      }
    },
    [isPreview, disabled, hideFieldDropdowns]
  )

  // Create env var select handler for a field
  const createEnvVarSelectHandler = useCallback(
    (fieldId: string, fieldValue: string, onFieldChange: (newValue: string) => void) => {
      return (newValue: string) => {
        if (!isPreview && !disabled) {
          onFieldChange(newValue)
          hideFieldDropdowns(fieldId)
        }
      }
    },
    [isPreview, disabled, hideFieldDropdowns]
  )

  return {
    inputRef: inputRef as React.RefObject<HTMLTextAreaElement | HTMLInputElement>,
    valueString,
    isDisabled,
    cursorPosition,
    showEnvVars,
    showTags,
    searchTerm,
    activeSourceBlockId,
    handlers: {
      onChange: handleChange,
      onKeyDown: handleKeyDown,
      onDrop: handleDrop,
      onDragOver: handleDragOver,
      onFocus: handleFocus,
      onScroll,
    },
    workspaceId,
    controls: {
      hideEnvVars: () => {
        setShowEnvVars(false)
        setSearchTerm('')
      },
      hideTags: () => {
        setShowTags(false)
        setActiveSourceBlockId(null)
      },
      setActiveSourceBlockId,
    },
    fieldHelpers: {
      getFieldState,
      createFieldHandlers,
      hideFieldDropdowns,
      createTagSelectHandler,
      createEnvVarSelectHandler,
    },
  }
}
