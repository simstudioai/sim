'use client'

import { useEffect, useRef } from 'react'
import { ChevronDown, Copy, MoreVertical, Plus, Trash } from 'lucide-react'
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
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useVariablesStore } from '../../../../../../../stores/panel/variables/store'
import { Variable, VariableType } from '../../../../../../../stores/panel/variables/types'

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
      case 'string':
        return 'Aa'
      case 'number':
        return '123'
      case 'boolean':
        return '0/1'
      case 'object':
        return '{}'
      case 'array':
        return '[]'
      default:
        return '?'
    }
  }

  const getPlaceholder = (type: VariableType) => {
    switch (type) {
      case 'string':
        return '"Hello world"'
      case 'number':
        return '42'
      case 'boolean':
        return 'true'
      case 'object':
        return '{\n  "key": "value"\n}'
      case 'array':
        return '[\n  1,\n  2,\n  3\n]'
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
        return 'javascript'
      default:
        return 'javascript'
    }
  }

  const formatValue = (variable: Variable) => {
    if (variable.value === '') return ''

    try {
      if (variable.type === 'object' || variable.type === 'array') {
        // Try to prettify if it's JSON
        const parsed = JSON.parse(variable.value as string)
        return JSON.stringify(parsed, null, 2)
      }

      // For string type, remove surrounding quotes for display
      if (variable.type === 'string') {
        const value = variable.value as string
        const trimmed = value.trim()

        // Remove surrounding quotes if they exist
        if (
          (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
          (trimmed.startsWith("'") && trimmed.endsWith("'"))
        ) {
          // Get the content between quotes and unescape any internal quotes
          return trimmed.slice(1, -1).replace(/\\"/g, '"')
        }
        return value
      }
    } catch (e) {
      // If not valid JSON, return as is
    }

    return variable.value as string
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

  // Handle editor value changes
  const handleEditorChange = (variable: Variable, newValue: string) => {
    // For string type, we send the raw input value so the store can handle quoting
    updateVariable(variable.id, { value: newValue })
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 pb-16 space-y-3">
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
                            onClick={() => updateVariable(variable.id, { type: 'string' })}
                            className="cursor-pointer flex items-center"
                          >
                            <div className="w-5 text-center mr-2 font-mono text-sm">Aa</div>
                            <span>String</span>
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
                      }}
                      className="focus:outline-none w-full"
                      textareaClassName="focus:outline-none focus:ring-0 bg-transparent resize-none w-full overflow-hidden whitespace-pre-wrap"
                    />
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
