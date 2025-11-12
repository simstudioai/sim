'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash, X } from 'lucide-react'
import { useParams } from 'next/navigation'
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
import { Label } from '@/components/ui/label'
import { createLogger } from '@/lib/logs/console/logger'
import { cn, validateName } from '@/lib/utils'
import { getVariablesPosition, useVariablesStore } from '@/stores/variables/store'
import type { Variable } from '@/stores/variables/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useChatBoundarySync, useChatDrag, useChatResize } from '../chat/hooks'

const logger = createLogger('FloatingVariables')

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
 * Floating Variables modal component
 *
 * Matches the visual and interaction style of the Chat modal:
 * - Draggable and resizable within the canvas bounds
 * - Persists position and size
 * - Uses emcn Input/Code/Combobox components for a consistent UI
 */
export function Variables() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { activeWorkflowId } = useWorkflowRegistry()

  // UI store
  const {
    isOpen,
    position,
    width,
    height,
    setIsOpen,
    setPosition,
    setDimensions,
    // Data
    variables,
    loadForWorkflow,
    addVariable,
    updateVariable,
    deleteVariable,
    getVariablesByWorkflowId,
  } = useVariablesStore()

  // Local UI helpers
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

  // Data for current workflow
  const workflowVariables = useMemo(
    () => (activeWorkflowId ? getVariablesByWorkflowId(activeWorkflowId) : []),
    [activeWorkflowId, getVariablesByWorkflowId, variables]
  )

  useEffect(() => {
    if (activeWorkflowId) {
      loadForWorkflow(activeWorkflowId).catch((e) => logger.error('loadForWorkflow failed', e))
    }
  }, [activeWorkflowId, loadForWorkflow])

  // Ensure variables are loaded when the modal is opened
  useEffect(() => {
    if (isOpen && activeWorkflowId) {
      loadForWorkflow(activeWorkflowId).catch((e) => logger.error('loadForWorkflow failed', e))
    }
  }, [isOpen, activeWorkflowId, loadForWorkflow])

  // Local per-variable UI state
  const [collapsedById, setCollapsedById] = useState<Record<string, boolean>>({})
  const [localNames, setLocalNames] = useState<Record<string, string>>({})
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({})

  /**
   * Toggles the collapsed state of a variable
   */
  const toggleCollapsed = (variableId: string) => {
    setCollapsedById((prev) => ({
      ...prev,
      [variableId]: !prev[variableId],
    }))
  }

  /**
   * Clear local name/error state for a variable
   */
  const clearLocalState = (variableId: string) => {
    setLocalNames((prev) => {
      const updated = { ...prev }
      delete updated[variableId]
      return updated
    })
    setNameErrors((prev) => {
      const updated = { ...prev }
      delete updated[variableId]
      return updated
    })
  }

  /**
   * Clear error for a specific variable if present
   */
  const clearError = (variableId: string) => {
    setNameErrors((prev) => {
      if (!prev[variableId]) return prev
      const updated = { ...prev }
      delete updated[variableId]
      return updated
    })
  }

  /**
   * Adds a new variable to the list
   */
  const handleAddVariable = () => {
    if (!activeWorkflowId) return
    addVariable({
      name: '',
      type: 'plain',
      value: '',
      workflowId: activeWorkflowId,
    })
  }

  /**
   * Removes a variable by ID
   */
  const handleRemoveVariable = (variableId: string) => {
    deleteVariable(variableId)
  }

  /**
   * Updates a specific variable property
   */
  const handleUpdateVariable = (variableId: string, field: keyof Variable, value: any) => {
    const validatedValue =
      field === 'name' && typeof value === 'string' ? validateName(value) : value
    updateVariable(variableId, { [field]: validatedValue })
  }

  /**
   * Local handlers for name editing with validation akin to panel behavior
   */
  const isDuplicateName = (variableId: string, name: string): boolean => {
    if (!name.trim()) return false
    return workflowVariables.some((v) => v.id !== variableId && v.name === name.trim())
  }

  const handleVariableNameChange = (variableId: string, newName: string) => {
    const validatedName = validateName(newName)
    setLocalNames((prev) => ({
      ...prev,
      [variableId]: validatedName,
    }))
    clearError(variableId)
  }

  const handleVariableNameBlur = (variableId: string) => {
    const localName = localNames[variableId]
    if (localName === undefined) return

    const trimmedName = localName.trim()
    if (!trimmedName) {
      setNameErrors((prev) => ({
        ...prev,
        [variableId]: 'Variable name cannot be empty',
      }))
      return
    }

    if (isDuplicateName(variableId, trimmedName)) {
      setNameErrors((prev) => ({
        ...prev,
        [variableId]: 'Two variables cannot have the same name',
      }))
      return
    }

    updateVariable(variableId, { name: trimmedName })
    clearLocalState(variableId)
  }

  const handleVariableNameKeyDown = (
    variableId: string,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }

  /**
   * Formats variable value for display in editor
   */
  const formatValue = (variable: Variable) => {
    if (variable.value === '') return ''
    return typeof variable.value === 'string' ? variable.value : JSON.stringify(variable.value)
  }

  const handleClose = useCallback(() => {
    setIsOpen(false)
  }, [setIsOpen])

  /**
   * Renders the variable header with name, type badge, and action buttons
   */
  const renderVariableHeader = (variable: Variable, index: number) => (
    <div
      className='flex cursor-pointer items-center justify-between bg-transparent px-[10px] py-[5px]'
      onClick={() => toggleCollapsed(variable.id)}
    >
      <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
        <span className='block truncate font-medium text-[#AEAEAE] text-[14px]'>
          {variable.name || `Variable ${index + 1}`}
        </span>
        {variable.name && <Badge className='h-[20px] text-[13px]'>{variable.type}</Badge>}
      </div>
      <div className='flex items-center gap-[8px] pl-[8px]' onClick={(e) => e.stopPropagation()}>
        <Button variant='ghost' onClick={handleAddVariable} className='h-auto p-0'>
          <Plus className='h-[14px] w-[14px]' />
          <span className='sr-only'>Add Variable</span>
        </Button>
        <Button
          variant='ghost'
          onClick={() => handleRemoveVariable(variable.id)}
          className='h-auto p-0 text-[#EF4444] hover:text-[#EF4444]'
        >
          <Trash className='h-[14px] w-[14px]' />
          <span className='sr-only'>Delete Variable</span>
        </Button>
      </div>
    </div>
  )

  /**
   * Renders the value input based on variable type
   */
  const renderValueInput = (variable: Variable) => {
    const variableValue = formatValue(variable)

    if (variable.type === 'object' || variable.type === 'array') {
      const lineCount = variableValue.split('\n').length
      const gutterWidth = calculateGutterWidth(lineCount)
      const placeholder = variable.type === 'object' ? '{\n  "key": "value"\n}' : '[\n  1, 2, 3\n]'

      const renderLineNumbers = () => {
        return Array.from({ length: lineCount }, (_, i) => (
          <div
            key={i}
            className='font-medium font-mono text-[#787878] text-xs'
            style={{ height: `${21}px`, lineHeight: `${21}px` }}
          >
            {i + 1}
          </div>
        ))
      }

      return (
        <Code.Container className='min-h-[120px]'>
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
        value={variableValue}
        onChange={(e) => handleUpdateVariable(variable.id, 'value', e.target.value)}
        placeholder={
          variable.type === 'number'
            ? '42'
            : variable.type === 'boolean'
              ? 'true'
              : 'Plain text value'
        }
      />
    )
  }

  if (!isOpen) return null

  return (
    <div
      className='fixed z-30 flex flex-col overflow-hidden rounded-[6px] bg-[#1E1E1E] px-[10px] pt-[2px] pb-[8px]'
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
        className='flex h-[32px] flex-shrink-0 cursor-grab items-center justify-between bg-[#1E1E1E] p-0 active:cursor-grabbing'
        onMouseDown={handleMouseDown}
      >
        <div className='flex items-center'>
          <span className='flex-shrink-0 font-medium text-[#E6E6E6] text-[14px]'>Variables</span>
        </div>
        <div className='flex items-center gap-[8px]'>
          <Button
            variant='ghost'
            className='!p-1.5 -m-1.5'
            onClick={(e) => {
              e.stopPropagation()
              handleAddVariable()
            }}
          >
            <Plus className='h-[16px] w-[16px]' />
          </Button>
          <Button variant='ghost' className='!p-1.5 -m-1.5' onClick={handleClose}>
            <X className='h-[16px] w-[16px]' />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className='flex flex-1 flex-col overflow-hidden pt-[8px]'>
        {workflowVariables.length === 0 ? (
          <div className='flex flex-1 items-center justify-center text-[#8D8D8D] text-[13px]'>
            No variables yet
          </div>
        ) : (
          <div className='h-full overflow-y-auto overflow-x-hidden'>
            <div className='w-full max-w-full space-y-[8px] overflow-hidden'>
              {workflowVariables.map((variable, index) => (
                <div
                  key={variable.id}
                  className={cn(
                    'rounded-[4px] border border-[#303030] bg-[#1F1F1F]',
                    (collapsedById[variable.id] ?? false) ? 'overflow-hidden' : 'overflow-visible'
                  )}
                >
                  {renderVariableHeader(variable, index)}

                  {!(collapsedById[variable.id] ?? false) && (
                    <div className='flex flex-col gap-[6px] border-[#303030] border-t px-[10px] pt-[6px] pb-[10px]'>
                      <div className='flex flex-col gap-[4px]'>
                        <Label className='text-[13px]'>Name</Label>
                        <Input
                          name='name'
                          value={localNames[variable.id] ?? variable.name}
                          onChange={(e) => handleVariableNameChange(variable.id, e.target.value)}
                          onBlur={() => handleVariableNameBlur(variable.id)}
                          onKeyDown={(e) => handleVariableNameKeyDown(variable.id, e)}
                          placeholder='variableName'
                        />
                        {nameErrors[variable.id] && (
                          <div className='mt-1 text-red-400 text-xs'>{nameErrors[variable.id]}</div>
                        )}
                      </div>

                      <div className='space-y-[4px]'>
                        <Label className='text-[13px]'>Type</Label>
                        <Combobox
                          options={TYPE_OPTIONS}
                          value={variable.type}
                          onChange={(value) => handleUpdateVariable(variable.id, 'type', value)}
                        />
                      </div>

                      <div className='space-y-[4px]'>
                        <Label className='text-[13px]'>Value</Label>
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
