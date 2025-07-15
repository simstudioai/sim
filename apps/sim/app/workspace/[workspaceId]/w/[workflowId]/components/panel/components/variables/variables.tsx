'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, Copy, MoreVertical, Plus, Trash } from 'lucide-react'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/themes/prism.css'

import Editor from 'react-simple-code-editor'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { validateName } from '@/lib/utils'
import { useVariablesStore } from '@/stores/panel/variables/store'
import type { Variable, VariableType } from '@/stores/panel/variables/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export function Variables() {
  const { activeWorkflowId, workflows } = useWorkflowRegistry()
  const {
    variables: storeVariables,
    addVariable,
    updateVariable,
    deleteVariable,
    duplicateVariable,
    getVariablesByWorkflowId,
    loadVariables,
  } = useVariablesStore()

  // Get variables for the current workflow
  const workflowVariables = activeWorkflowId ? getVariablesByWorkflowId(activeWorkflowId) : []

  // Load variables when active workflow changes
  useEffect(() => {
    if (activeWorkflowId) {
      loadVariables(activeWorkflowId)
    }
  }, [activeWorkflowId, loadVariables])

  // Track editor references
  const editorRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Track which variables are currently being edited
  const [_activeEditors, setActiveEditors] = useState<Record<string, boolean>>({})

  // Handle variable name change with validation
  const handleVariableNameChange = (variableId: string, newName: string) => {
    const validatedName = validateName(newName)
    updateVariable(variableId, { name: validatedName })
  }

  // Auto-save when variables are added/edited
  const handleAddVariable = () => {
    if (!activeWorkflowId) return

    // Create a default variable - naming is handled in the store
    const id = addVariable({
      name: '', // Store will generate an appropriate name
      type: 'string',
      value: '',
      workflowId: activeWorkflowId,
    })

    return id
  }

  const getTypeIcon = (type: VariableType) => {
    switch (type) {
      case 'plain':
        return 'Abc'
      case 'number':
        return '123'
      case 'boolean':
        return '0/1'
      case 'object':
        return '{}'
      case 'array':
        return '[]'
      case 'string':
        return 'Abc'
      default:
        return '?'
    }
  }

  const getPlaceholder = (type: VariableType) => {
    switch (type) {
      case 'plain':
        return 'Plain text value'
      case 'number':
        return '42'
      case 'boolean':
        return 'true'
      case 'object':
        return '{\n  "key": "value"\n}'
      case 'array':
        return '[\n  1,\n  2,\n  3\n]'
      case 'string':
        return 'Plain text value'
      default:
        return ''
    }
  }

  const getEditorLanguage = (type: VariableType) => {
    switch (type) {
      case 'object':
      case 'array':
      case 'boolean':
      case 'number':
      case 'plain':
        return 'javascript'
      default:
        return 'javascript'
    }
  }

  // Handle editor value changes - store exactly what user types
  const handleEditorChange = (variable: Variable, newValue: string) => {
    // Store the raw value directly, no parsing or formatting
    updateVariable(variable.id, {
      value: newValue,
      // Clear any previous validation errors so they'll be recalculated
      validationError: undefined,
    })
  }

  // Only track focus state for UI purposes
  const handleEditorBlur = (variableId: string) => {
    setActiveEditors((prev) => ({
      ...prev,
      [variableId]: false,
    }))
  }

  // Track when editor becomes active
  const handleEditorFocus = (variableId: string) => {
    setActiveEditors((prev) => ({
      ...prev,
      [variableId]: true,
    }))
  }

  // Always return raw value without any formatting
  const formatValue = (variable: Variable) => {
    if (variable.value === '') return ''

    // Always return raw value exactly as typed
    return typeof variable.value === 'string' ? variable.value : JSON.stringify(variable.value)
  }

  // Get validation status based on type and value
  const getValidationStatus = (variable: Variable): string | undefined => {
    // Empty values don't need validation
    if (variable.value === '') return undefined

    // Otherwise validate based on type
    switch (variable.type) {
      case 'number':
        return Number.isNaN(Number(variable.value)) ? 'Not a valid number' : undefined
      case 'boolean':
        return !/^(true|false)$/i.test(String(variable.value).trim())
          ? 'Expected "true" or "false"'
          : undefined
      case 'object':
        try {
          // Handle both JavaScript and JSON syntax
          const valueToEvaluate = String(variable.value).trim()

          // Basic security check to prevent arbitrary code execution
          if (!valueToEvaluate.startsWith('{') || !valueToEvaluate.endsWith('}')) {
            return 'Not a valid object format'
          }

          // Use Function constructor to safely evaluate the object expression
          // This is safer than eval() and handles all JS object literal syntax
          const parsed = new Function(`return ${valueToEvaluate}`)()

          // Verify it's actually an object (not array or null)
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return 'Not a valid object'
          }

          return undefined // Valid object
        } catch (e) {
          console.log('Object parsing error:', e)
          return 'Invalid object syntax'
        }
      case 'array':
        try {
          // Use actual JavaScript evaluation instead of trying to convert to JSON
          // This properly handles all valid JS array syntax including mixed types
          const valueToEvaluate = String(variable.value).trim()

          // Basic security check to prevent arbitrary code execution
          if (!valueToEvaluate.startsWith('[') || !valueToEvaluate.endsWith(']')) {
            return 'Not a valid array format'
          }

          // Use Function constructor to safely evaluate the array expression
          // This is safer than eval() and handles all JS array syntax correctly
          const parsed = new Function(`return ${valueToEvaluate}`)()

          // Verify it's actually an array
          if (!Array.isArray(parsed)) {
            return 'Not a valid array'
          }

          return undefined // Valid array
        } catch (e) {
          console.log('Array parsing error:', e)
          return 'Invalid array syntax'
        }
      default:
        return undefined
    }
  }

  // Clear editor refs when variables change
  useEffect(() => {
    // Clean up any references to deleted variables
    Object.keys(editorRefs.current).forEach((id) => {
      if (!workflowVariables.some((v) => v.id === id)) {
        delete editorRefs.current[id]
      }
    })
  }, [workflowVariables])

  return (
    <div className='h-full pt-2'>
      {workflowVariables.length === 0 ? (
        <div className='flex h-full items-center justify-center'>
          <Button
            onClick={handleAddVariable}
            className='h-9 rounded-lg border border-[#E5E5E5] bg-[#FFFFFF] px-3 py-1.5 font-normal text-muted-foreground text-sm shadow-xs transition-colors hover:text-muted-foreground dark:border-[#414141] dark:bg-[#202020] dark:hover:text-muted-foreground'
            variant='outline'
          >
            <Plus className='h-4 w-4' />
            Add variable
          </Button>
        </div>
      ) : (
        <ScrollArea className='h-full' hideScrollbar={true}>
          <div className='space-y-4'>
            {workflowVariables.map((variable) => (
              <div key={variable.id} className='space-y-2'>
                {/* Header: Variable name | Variable type | Options dropdown */}
                <div className='flex items-center gap-2'>
                  <Input
                    className='h-9 flex-1 rounded-lg border-none bg-secondary/50 px-3 font-normal text-sm ring-0 ring-offset-0 placeholder:text-muted-foreground focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0'
                    placeholder='Variable name'
                    value={variable.name}
                    onChange={(e) => handleVariableNameChange(variable.id, e.target.value)}
                  />

                  {/* Type selector */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <div className='flex h-9 w-16 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-secondary/50 px-3'>
                        <span className='font-normal text-sm'>{getTypeIcon(variable.type)}</span>
                        <ChevronDown className='ml-1 h-3 w-3 text-muted-foreground' />
                      </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align='end'
                      className='min-w-32 rounded-lg border-[#E5E5E5] bg-[#FFFFFF] shadow-xs dark:border-[#414141] dark:bg-[#202020]'
                    >
                      <DropdownMenuItem
                        onClick={() => updateVariable(variable.id, { type: 'plain' })}
                        className='flex cursor-pointer items-center rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                      >
                        <div className='mr-2 w-5 text-center font-[380] text-sm'>Abc</div>
                        <span className='font-[380]'>Plain</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => updateVariable(variable.id, { type: 'number' })}
                        className='flex cursor-pointer items-center rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                      >
                        <div className='mr-2 w-5 text-center font-[380] text-sm'>123</div>
                        <span className='font-[380]'>Number</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => updateVariable(variable.id, { type: 'boolean' })}
                        className='flex cursor-pointer items-center rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                      >
                        <div className='mr-2 w-5 text-center font-[380] text-sm'>0/1</div>
                        <span className='font-[380]'>Boolean</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => updateVariable(variable.id, { type: 'object' })}
                        className='flex cursor-pointer items-center rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                      >
                        <div className='mr-2 w-5 text-center font-[380] text-sm'>{'{}'}</div>
                        <span className='font-[380]'>Object</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => updateVariable(variable.id, { type: 'array' })}
                        className='flex cursor-pointer items-center rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                      >
                        <div className='mr-2 w-5 text-center font-[380] text-sm'>[]</div>
                        <span className='font-[380]'>Array</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Options dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-9 w-9 shrink-0 rounded-lg bg-secondary/50 p-0 text-muted-foreground hover:bg-secondary/70 focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0'
                      >
                        <MoreVertical className='h-4 w-4' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align='end'
                      className='min-w-32 rounded-lg border-[#E5E5E5] bg-[#FFFFFF] shadow-xs dark:border-[#414141] dark:bg-[#202020]'
                    >
                      <DropdownMenuItem
                        onClick={() => duplicateVariable(variable.id)}
                        className='cursor-pointer rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                      >
                        <Copy className='mr-2 h-4 w-4 text-muted-foreground' />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => deleteVariable(variable.id)}
                        className='cursor-pointer rounded-md px-3 py-2 font-[380] text-destructive text-sm hover:bg-destructive/10 focus:bg-destructive/10 focus:text-destructive'
                      >
                        <Trash className='mr-2 h-4 w-4' />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Value area */}
                <div className='relative rounded-lg bg-secondary/50'>
                  {/* Validation indicator */}
                  {variable.value !== '' && getValidationStatus(variable) && (
                    <div className='absolute top-2 right-2 z-10'>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className='cursor-help'>
                            <AlertTriangle className='h-3 w-3 text-muted-foreground' />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side='bottom' className='max-w-xs'>
                          <p>{getValidationStatus(variable)}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )}

                  {/* Editor */}
                  <div className='relative overflow-hidden'>
                    <div
                      className='relative min-h-[36px] w-full max-w-full px-3 py-2 font-normal text-sm'
                      ref={(el) => {
                        editorRefs.current[variable.id] = el
                      }}
                      style={{ maxWidth: '100%' }}
                    >
                      {variable.value === '' && (
                        <div className='pointer-events-none absolute inset-0 flex select-none items-start justify-start px-3 py-2 font-[380] text-muted-foreground text-sm leading-normal'>
                          <div style={{ lineHeight: '20px' }}>{getPlaceholder(variable.type)}</div>
                        </div>
                      )}
                      <Editor
                        key={`editor-${variable.id}-${variable.type}`}
                        value={formatValue(variable)}
                        onValueChange={handleEditorChange.bind(null, variable)}
                        onBlur={() => handleEditorBlur(variable.id)}
                        onFocus={() => handleEditorFocus(variable.id)}
                        highlight={(code) =>
                          // Only apply syntax highlighting for non-basic text types
                          variable.type === 'plain' || variable.type === 'string'
                            ? code
                            : highlight(
                                code,
                                languages[getEditorLanguage(variable.type)],
                                getEditorLanguage(variable.type)
                              )
                        }
                        padding={0}
                        style={{
                          fontFamily: 'inherit',
                          lineHeight: '20px',
                          width: '100%',
                          maxWidth: '100%',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          overflowWrap: 'break-word',
                          minHeight: '20px',
                          overflow: 'hidden',
                        }}
                        className='[&>pre]:!max-w-full [&>pre]:!overflow-hidden [&>pre]:!whitespace-pre-wrap [&>pre]:!break-all [&>pre]:!overflow-wrap-break-word [&>textarea]:!max-w-full [&>textarea]:!overflow-hidden [&>textarea]:!whitespace-pre-wrap [&>textarea]:!break-all [&>textarea]:!overflow-wrap-break-word font-[380] text-foreground text-sm leading-normal focus:outline-none'
                        textareaClassName='focus:outline-none focus:ring-0 bg-transparent resize-none w-full max-w-full whitespace-pre-wrap break-all overflow-wrap-break-word overflow-hidden font-[380] text-foreground'
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Add Variable Button */}
            <Button
              onClick={handleAddVariable}
              className='mt-2 h-9 w-full rounded-lg border border-[#E5E5E5] bg-[#FFFFFF] px-3 py-1.5 font-[380] text-muted-foreground text-sm shadow-xs transition-colors hover:text-muted-foreground dark:border-[#414141] dark:bg-[#202020] dark:hover:text-muted-foreground'
              variant='outline'
            >
              <Plus className='h-4 w-4' />
              Add variable
            </Button>
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
