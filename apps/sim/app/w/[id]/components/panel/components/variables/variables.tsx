'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  MoreVertical,
  Plus,
  Trash,
} from 'lucide-react'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/themes/prism.css'
import Editor from 'react-simple-code-editor'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { VariableManager } from '@/lib/variables/variable-manager'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { Variable, VariableType } from '@/stores/panel/variables/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface VariablesProps {
  panelWidth: number
}

export function Variables({ panelWidth }: VariablesProps) {
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

  // Load variables when workflow changes
  useEffect(() => {
    if (activeWorkflowId && workflows[activeWorkflowId]) {
      loadVariables(activeWorkflowId)
    }
  }, [activeWorkflowId, workflows, loadVariables])

  // Track editor references
  const editorRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Track which variables are currently being edited
  const [activeEditors, setActiveEditors] = useState<Record<string, boolean>>({})

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
        return isNaN(Number(variable.value)) ? 'Not a valid number' : undefined
      case 'boolean':
        return !/^(true|false)$/i.test(String(variable.value).trim())
          ? 'Expected "true" or "false"'
          : undefined
      case 'object':
        try {
          // Handle both JavaScript and JSON syntax
          let valueToValidate = String(variable.value).trim()

          // If it's clearly JS syntax, convert it to valid JSON
          if (valueToValidate.includes("'") || /\b\w+\s*:/.test(valueToValidate)) {
            // Replace JS single quotes with double quotes, but handle escaped quotes correctly
            valueToValidate = valueToValidate
              .replace(/(\w+)\s*:/g, '"$1":') // Convert unquoted property names to quoted
              .replace(/'/g, '"') // Replace single quotes with double quotes
          }

          const parsed = JSON.parse(valueToValidate)
          return !parsed || typeof parsed !== 'object' || Array.isArray(parsed)
            ? 'Not a valid JSON object'
            : undefined
        } catch {
          return 'Invalid JSON object syntax'
        }
      case 'array':
        try {
          // Use actual JavaScript evaluation instead of trying to convert to JSON
          // This properly handles all valid JS array syntax including mixed types
          let valueToEvaluate = String(variable.value).trim()

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
    <ScrollArea className="h-full">
      <div className="p-4 space-y-3">
        {/* Variables List */}
        {workflowVariables.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-sm text-muted-foreground pt-4">
            <div className="mb-2">No variables yet</div>
            <Button variant="outline" size="sm" className="text-xs" onClick={handleAddVariable}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add your first variable
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {workflowVariables.map((variable) => (
                <div
                  key={variable.id}
                  className="group flex flex-col space-y-2 rounded-lg border bg-background shadow-sm"
                >
                  <div className="flex items-center justify-between p-3 border-b bg-muted/30">
                    <div className="flex-1 flex items-center gap-2">
                      <Input
                        className="h-9 bg-background border-input focus-visible:ring-1 focus-visible:ring-ring max-w-40 !text-md"
                        placeholder="Variable name"
                        value={variable.name}
                        onChange={(e) => updateVariable(variable.id, { name: e.target.value })}
                      />

                      <DropdownMenu>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" className="h-9 gap-1">
                                <span className="text-sm !font-mono pt-[0.3px]">
                                  {getTypeIcon(variable.type)}
                                </span>
                                <ChevronDown className="!h-3.5 !w-3.5 text-muted-foreground" />
                              </Button>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent side="top">Set variable type</TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent align="end" className="min-w-32">
                          <DropdownMenuItem
                            onClick={() => updateVariable(variable.id, { type: 'plain' })}
                            className="cursor-pointer flex items-center"
                          >
                            <div className="w-5 text-center mr-2 font-mono text-sm">Abc</div>
                            <span>Plain</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateVariable(variable.id, { type: 'number' })}
                            className="cursor-pointer flex items-center"
                          >
                            <div className="w-5 text-center mr-2 font-mono text-sm">123</div>
                            <span>Number</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateVariable(variable.id, { type: 'boolean' })}
                            className="cursor-pointer flex items-center"
                          >
                            <div className="w-5 text-center mr-2 font-mono text-sm">0/1</div>
                            <span>Boolean</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateVariable(variable.id, { type: 'object' })}
                            className="cursor-pointer flex items-center"
                          >
                            <div className="w-5 text-center mr-2 font-mono text-sm">{'{}'}</div>
                            <span>Object</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateVariable(variable.id, { type: 'array' })}
                            className="cursor-pointer flex items-center"
                          >
                            <div className="w-5 text-center mr-2 font-mono text-sm">[]</div>
                            <span>Array</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <div className="flex items-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 text-muted-foreground"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => duplicateVariable(variable.id)}
                              className="cursor-pointer text-muted-foreground"
                            >
                              <Copy className="h-4 w-4 mr-2 text-muted-foreground" />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => deleteVariable(variable.id)}
                              className="cursor-pointer text-destructive focus:text-destructive"
                            >
                              <Trash className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>

                  <div
                    className="relative min-h-[36px] rounded-md bg-background font-mono text-sm px-4 pt-2 pb-3"
                    ref={(el) => {
                      editorRefs.current[variable.id] = el
                    }}
                    style={{
                      maxWidth: panelWidth ? `${panelWidth - 50}px` : '100%',
                      overflowWrap: 'break-word',
                    }}
                  >
                    {variable.value === '' && (
                      <div className="absolute top-[8.5px] left-4 text-muted-foreground/50 pointer-events-none select-none">
                        {getPlaceholder(variable.type)}
                      </div>
                    )}
                    <Editor
                      key={`editor-${variable.id}-${variable.type}`}
                      value={formatValue(variable)}
                      onValueChange={handleEditorChange.bind(null, variable)}
                      onBlur={() => handleEditorBlur(variable.id)}
                      onFocus={() => handleEditorFocus(variable.id)}
                      highlight={(code) =>
                        highlight(
                          code,
                          languages[getEditorLanguage(variable.type)],
                          getEditorLanguage(variable.type)
                        )
                      }
                      padding={0}
                      style={{
                        fontFamily: 'inherit',
                        lineHeight: '21px',
                        width: '100%',
                        wordWrap: 'break-word',
                        whiteSpace: 'pre-wrap',
                      }}
                      className="focus:outline-none w-full"
                      textareaClassName="focus:outline-none focus:ring-0 bg-transparent resize-none w-full whitespace-pre-wrap break-words overflow-visible"
                    />

                    {/* Show validation indicator for any non-empty variable */}
                    {variable.value !== '' && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="absolute top-[4px] right-[0px] cursor-help group">
                            {getValidationStatus(variable) && (
                              <div className="p-1 rounded-md group-hover:bg-muted/80 group-hover:shadow-sm transition-all duration-200 border border-transparent group-hover:border-muted/50">
                                <AlertTriangle className="h-4 w-4 text-muted-foreground opacity-30 group-hover:opacity-100 transition-opacity duration-200" />
                              </div>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs">
                          {getValidationStatus(variable) && <p>{getValidationStatus(variable)}</p>}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add Variable Button */}
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 text-xs w-full justify-start text-muted-foreground hover:text-foreground"
              onClick={handleAddVariable}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add variable
            </Button>
          </>
        )}
      </div>
    </ScrollArea>
  )
}
