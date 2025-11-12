'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import Editor from 'react-simple-code-editor'
import type { ComboboxOption } from '@/components/emcn'
import {
  Badge,
  Button,
  Code,
  Combobox,
  calculateGutterWidth,
  getCodeEditorProps,
  highlight,
  Input,
  languages,
} from '@/components/emcn'
import { Label } from '@/components/emcn/components/label/label'
import { Trash } from '@/components/emcn/icons/trash'
import { cn, validateName } from '@/lib/utils'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useVariablesStore as usePanelVariablesStore } from '@/stores/panel/variables/store'
import { getVariablesPosition, useVariablesStore } from '@/stores/variables/store'
import type { Variable } from '@/stores/variables/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useChatBoundarySync, useChatDrag, useChatResize } from '../chat/hooks'

/**
 * Type options for variable type selection
 */
const TYPE_OPTIONS: ComboboxOption[] = [
  { label: 'Plain', value: 'plain' },
  { label: 'Number', value: 'number' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Object', value: 'object' },
  { label: 'Array', value: 'array' },
]

/**
 * UI constants for consistent styling and sizing
 */
const BADGE_HEIGHT = 20
const BADGE_TEXT_SIZE = 13
const ICON_SIZE = 14
const HEADER_ICON_SIZE = 16
const LINE_HEIGHT = 21
const MIN_EDITOR_HEIGHT = 120

/**
 * User-facing strings for errors, labels, and placeholders
 */
const STRINGS = {
  errors: {
    emptyName: 'Variable name cannot be empty',
    duplicateName: 'Two variables cannot have the same name',
  },
  labels: {
    name: 'Name',
    type: 'Type',
    value: 'Value',
  },
  placeholders: {
    name: 'variableName',
    number: '42',
    boolean: 'true',
    plain: 'Plain text value',
    object: '{\n  "key": "value"\n}',
    array: '[\n  1, 2, 3\n]',
  },
  emptyState: 'No variables yet',
}

/**
 * Floating Variables modal component
 *
 * Matches the visual and interaction style of the Chat modal:
 * - Draggable and resizable within the canvas bounds
 * - Persists position and size
 * - Uses emcn Input/Code/Combobox components for a consistent UI
 */
export function Variables() {
  const { activeWorkflowId } = useWorkflowRegistry()

  const { isOpen, position, width, height, setIsOpen, setPosition, setDimensions } =
    useVariablesStore()

  const { getVariablesByWorkflowId } = usePanelVariablesStore()

  const { collaborativeUpdateVariable, collaborativeAddVariable, collaborativeDeleteVariable } =
    useCollaborativeWorkflow()

  const workflowVariables = activeWorkflowId ? getVariablesByWorkflowId(activeWorkflowId) : []

  const actualPosition = useMemo(
    () => getVariablesPosition(position, width, height),
    [position, width, height]
  )

  const { handleMouseDown } = useChatDrag({
    position: actualPosition,
    width,
    height,
    onPositionChange: setPosition,
  })

  useChatBoundarySync({
    isOpen,
    position: actualPosition,
    width,
    height,
    onPositionChange: setPosition,
  })

  const {
    cursor: resizeCursor,
    handleMouseMove: handleResizeMouseMove,
    handleMouseLeave: handleResizeMouseLeave,
    handleMouseDown: handleResizeMouseDown,
  } = useChatResize({
    position: actualPosition,
    width,
    height,
    onPositionChange: setPosition,
    onDimensionsChange: setDimensions,
  })

  const [collapsedById, setCollapsedById] = useState<Record<string, boolean>>({})
  const [localNames, setLocalNames] = useState<Record<string, string>>({})
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({})
  const cleanupState = useCallback(
    (
      setter: React.Dispatch<React.SetStateAction<Record<string, any>>>,
      currentIds: Set<string>
    ) => {
      setter((prev) => {
        const filtered = Object.fromEntries(
          Object.entries(prev).filter(([id]) => currentIds.has(id))
        )
        return Object.keys(filtered).length !== Object.keys(prev).length ? filtered : prev
      })
    },
    []
  )

  useEffect(() => {
    const currentVariableIds = new Set(workflowVariables.map((v) => v.id))
    cleanupState(setCollapsedById, currentVariableIds)
    cleanupState(setLocalNames, currentVariableIds)
    cleanupState(setNameErrors, currentVariableIds)
  }, [workflowVariables, cleanupState])

  const toggleCollapsed = (variableId: string) => {
    setCollapsedById((prev) => ({
      ...prev,
      [variableId]: !prev[variableId],
    }))
  }

  const handleHeaderKeyDown = (e: React.KeyboardEvent, variableId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleCollapsed(variableId)
    }
  }

  const clearVariableState = (variableId: string, clearNames = true) => {
    if (clearNames) {
      setLocalNames((prev) => {
        const updated = { ...prev }
        delete updated[variableId]
        return updated
      })
    }
    setNameErrors((prev) => {
      if (!prev[variableId]) return prev
      const updated = { ...prev }
      delete updated[variableId]
      return updated
    })
  }

  const handleAddVariable = useCallback(() => {
    if (!activeWorkflowId) return
    collaborativeAddVariable({
      name: '',
      type: 'plain',
      value: '',
      workflowId: activeWorkflowId,
    })
  }, [activeWorkflowId, collaborativeAddVariable])

  const handleRemoveVariable = useCallback(
    (variableId: string) => {
      collaborativeDeleteVariable(variableId)
    },
    [collaborativeDeleteVariable]
  )

  const handleUpdateVariable = useCallback(
    (variableId: string, field: 'name' | 'value' | 'type', value: any) => {
      collaborativeUpdateVariable(variableId, field, value)
    },
    [collaborativeUpdateVariable]
  )
  const isDuplicateName = useCallback(
    (variableId: string, name: string): boolean => {
      const trimmedName = name.trim()
      return (
        !!trimmedName &&
        workflowVariables.some((v) => v.id !== variableId && v.name === trimmedName)
      )
    },
    [workflowVariables]
  )

  const handleVariableNameChange = useCallback((variableId: string, newName: string) => {
    const validatedName = validateName(newName)
    setLocalNames((prev) => ({
      ...prev,
      [variableId]: validatedName,
    }))
    clearVariableState(variableId, false)
  }, [])

  const handleVariableNameBlur = useCallback(
    (variableId: string) => {
      const localName = localNames[variableId]
      if (localName === undefined) return

      const trimmedName = localName.trim()
      if (!trimmedName) {
        setNameErrors((prev) => ({
          ...prev,
          [variableId]: STRINGS.errors.emptyName,
        }))
        return
      }

      if (isDuplicateName(variableId, trimmedName)) {
        setNameErrors((prev) => ({
          ...prev,
          [variableId]: STRINGS.errors.duplicateName,
        }))
        return
      }

      collaborativeUpdateVariable(variableId, 'name', trimmedName)
      clearVariableState(variableId)
    },
    [localNames, isDuplicateName, collaborativeUpdateVariable]
  )

  const handleVariableNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }

  const handleClose = () => {
    setIsOpen(false)
  }

  const renderVariableHeader = useCallback(
    (variable: Variable, index: number) => {
      const isCollapsed = collapsedById[variable.id] ?? false
      return (
        <div
          className='flex cursor-pointer items-center justify-between bg-transparent px-[10px] py-[5px]'
          onClick={() => toggleCollapsed(variable.id)}
          onKeyDown={(e) => handleHeaderKeyDown(e, variable.id)}
          role='button'
          tabIndex={0}
          aria-expanded={!isCollapsed}
          aria-controls={`variable-content-${variable.id}`}
        >
          <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
            <span className='block truncate font-medium text-[14px] text-[var(--text-tertiary)]'>
              {variable.name || `Variable ${index + 1}`}
            </span>
            {variable.name && (
              <Badge style={{ height: `${BADGE_HEIGHT}px`, fontSize: `${BADGE_TEXT_SIZE}px` }}>
                {variable.type}
              </Badge>
            )}
          </div>
          <Button
            variant='ghost'
            onClick={(e) => {
              e.stopPropagation()
              handleRemoveVariable(variable.id)
            }}
            className='h-auto p-0 text-[var(--text-error)] hover:text-[var(--text-error)]'
            aria-label={`Delete ${variable.name || `variable ${index + 1}`}`}
          >
            <Trash style={{ width: `${ICON_SIZE}px`, height: `${ICON_SIZE}px` }} />
            <span className='sr-only'>Delete Variable</span>
          </Button>
        </div>
      )
    },
    [collapsedById, toggleCollapsed, handleRemoveVariable]
  )

  /**
   * Renders the value input based on variable type.
   * Memoized with useCallback to prevent unnecessary re-renders.
   */
  const renderValueInput = useCallback(
    (variable: Variable) => {
      const variableValue =
        variable.value === ''
          ? ''
          : typeof variable.value === 'string'
            ? variable.value
            : JSON.stringify(variable.value)

      if (variable.type === 'object' || variable.type === 'array') {
        const lineCount = variableValue.split('\n').length
        const gutterWidth = calculateGutterWidth(lineCount)
        const placeholder =
          variable.type === 'object' ? STRINGS.placeholders.object : STRINGS.placeholders.array

        const renderLineNumbers = () => {
          return Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i}
              className='font-medium font-mono text-[var(--text-muted)] text-xs'
              style={{ height: `${LINE_HEIGHT}px`, lineHeight: `${LINE_HEIGHT}px` }}
            >
              {i + 1}
            </div>
          ))
        }

        return (
          <Code.Container style={{ minHeight: `${MIN_EDITOR_HEIGHT}px` }}>
            <Code.Gutter width={gutterWidth}>{renderLineNumbers()}</Code.Gutter>
            <Code.Content paddingLeft={`${gutterWidth}px`}>
              <Code.Placeholder gutterWidth={gutterWidth} show={variableValue.length === 0}>
                {placeholder}
              </Code.Placeholder>
              <Editor
                value={variableValue}
                onValueChange={(newValue) => handleUpdateVariable(variable.id, 'value', newValue)}
                highlight={(code) => highlight(code, languages.json, 'json')}
                {...getCodeEditorProps()}
              />
            </Code.Content>
          </Code.Container>
        )
      }

      return (
        <Input
          name='value'
          autoComplete='off'
          value={variableValue}
          onChange={(e) => handleUpdateVariable(variable.id, 'value', e.target.value)}
          placeholder={
            variable.type === 'number'
              ? STRINGS.placeholders.number
              : variable.type === 'boolean'
                ? STRINGS.placeholders.boolean
                : STRINGS.placeholders.plain
          }
        />
      )
    },
    [handleUpdateVariable]
  )

  if (!isOpen) return null

  return (
    <div
      className='fixed z-30 flex flex-col overflow-hidden rounded-[6px] bg-[var(--surface-1)] px-[10px] pt-[2px] pb-[8px]'
      style={{
        left: `${actualPosition.x}px`,
        top: `${actualPosition.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        cursor: resizeCursor || undefined,
      }}
      onMouseMove={handleResizeMouseMove}
      onMouseLeave={handleResizeMouseLeave}
      onMouseDown={handleResizeMouseDown}
    >
      {/* Header (drag handle) */}
      <div
        className='flex h-[32px] flex-shrink-0 cursor-grab items-center justify-between bg-[var(--surface-1)] p-0 active:cursor-grabbing'
        onMouseDown={handleMouseDown}
      >
        <div className='flex items-center'>
          <span className='flex-shrink-0 font-medium text-[14px] text-[var(--text-primary)]'>
            Variables
          </span>
        </div>
        <div className='flex items-center gap-[8px]'>
          <Button
            variant='ghost'
            className='!p-1.5 -m-1.5'
            onClick={(e) => {
              e.stopPropagation()
              handleAddVariable()
            }}
            aria-label='Add new variable'
          >
            <Plus style={{ width: `${HEADER_ICON_SIZE}px`, height: `${HEADER_ICON_SIZE}px` }} />
          </Button>
          <Button
            variant='ghost'
            className='!p-1.5 -m-1.5'
            onClick={handleClose}
            aria-label='Close variables panel'
          >
            <X style={{ width: `${HEADER_ICON_SIZE}px`, height: `${HEADER_ICON_SIZE}px` }} />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className='flex flex-1 flex-col overflow-hidden pt-[8px]'>
        {workflowVariables.length === 0 ? (
          <div className='flex flex-1 items-center justify-center text-[13px] text-[var(--text-tertiary)]'>
            {STRINGS.emptyState}
          </div>
        ) : (
          <div className='h-full overflow-y-auto overflow-x-hidden'>
            <div className='w-full max-w-full space-y-[8px] overflow-hidden'>
              {workflowVariables.map((variable, index) => (
                <div
                  key={variable.id}
                  className={cn(
                    'rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-1)]',
                    (collapsedById[variable.id] ?? false) ? 'overflow-hidden' : 'overflow-visible'
                  )}
                >
                  {renderVariableHeader(variable, index)}

                  {!(collapsedById[variable.id] ?? false) && (
                    <div
                      id={`variable-content-${variable.id}`}
                      className='flex flex-col gap-[6px] border-[var(--border-strong)] border-t px-[10px] pt-[6px] pb-[10px]'
                    >
                      <div className='flex flex-col gap-[4px]'>
                        <Label className='text-[13px]'>{STRINGS.labels.name}</Label>
                        <Input
                          name='name'
                          autoComplete='off'
                          value={localNames[variable.id] ?? variable.name}
                          onChange={(e) => handleVariableNameChange(variable.id, e.target.value)}
                          onBlur={() => handleVariableNameBlur(variable.id)}
                          onKeyDown={handleVariableNameKeyDown}
                          placeholder={STRINGS.placeholders.name}
                        />
                        {nameErrors[variable.id] && (
                          <p className='text-[var(--text-error)] text-xs' role='alert'>
                            {nameErrors[variable.id]}
                          </p>
                        )}
                      </div>

                      <div className='space-y-[4px]'>
                        <Label className='text-[13px]'>{STRINGS.labels.type}</Label>
                        <Combobox
                          options={TYPE_OPTIONS}
                          value={variable.type}
                          onChange={(value) => handleUpdateVariable(variable.id, 'type', value)}
                        />
                      </div>

                      <div className='space-y-[4px]'>
                        <Label className='text-[13px]'>{STRINGS.labels.value}</Label>
                        <div className='relative'>{renderValueInput(variable)}</div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
