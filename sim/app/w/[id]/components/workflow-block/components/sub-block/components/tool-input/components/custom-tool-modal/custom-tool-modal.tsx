import { useEffect, useMemo, useRef, useState } from 'react'
import { Code, FileJson, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { Label } from '@/components/ui/label'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import { CodeEditor } from '../code-editor/code-editor'

const logger = createLogger('CustomToolModal')

interface CustomToolModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (tool: CustomTool) => void
  initialValues?: {
    id?: string
    schema: any
    code: string
  }
}

export interface CustomTool {
  type: 'custom-tool'
  title: string
  name: string
  description: string
  schema: any
  code: string
  params: Record<string, string>
  isExpanded?: boolean
}

type ToolSection = 'schema' | 'code'

export function CustomToolModal({
  open,
  onOpenChange,
  onSave,
  initialValues,
}: CustomToolModalProps) {
  const [activeSection, setActiveSection] = useState<ToolSection>('schema')
  const [jsonSchema, setJsonSchema] = useState('')
  const [functionCode, setFunctionCode] = useState('')
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [toolId, setToolId] = useState<string | undefined>(undefined)

  // Environment variables and tags dropdown state
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const codeEditorRef = useRef<HTMLDivElement>(null)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  // Add state for dropdown positioning
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })

  const addTool = useCustomToolsStore((state) => state.addTool)
  const updateTool = useCustomToolsStore((state) => state.updateTool)

  // Initialize form with initial values if provided
  useEffect(() => {
    if (open && initialValues) {
      try {
        setJsonSchema(
          typeof initialValues.schema === 'string'
            ? initialValues.schema
            : JSON.stringify(initialValues.schema, null, 2)
        )
        setFunctionCode(initialValues.code || '')
        setIsEditing(true)
        setToolId(initialValues.id)
      } catch (error) {
        logger.error('Error initializing form with initial values:', { error })
        setSchemaError('Failed to load tool data. Please try again.')
      }
    } else if (open) {
      // Reset form when opening without initial values
      resetForm()
    }
  }, [open, initialValues])

  const resetForm = () => {
    setJsonSchema('')
    setFunctionCode('')
    setSchemaError(null)
    setCodeError(null)
    setActiveSection('schema')
    setIsEditing(false)
    setToolId(undefined)
  }

  const handleClose = () => {
    resetForm()
    onOpenChange(false)
  }

  // Pure validation function that doesn't update state
  const validateJsonSchema = (schema: string): boolean => {
    if (!schema) return false

    try {
      const parsed = JSON.parse(schema)

      // Basic validation for function schema
      if (!parsed.type || parsed.type !== 'function') {
        return false
      }

      if (!parsed.function || !parsed.function.name) {
        return false
      }

      return true
    } catch (error) {
      return false
    }
  }

  // Pure validation function that doesn't update state
  const validateFunctionCode = (code: string): boolean => {
    return true // Allow empty code
  }

  // Memoize validation results to prevent unnecessary recalculations
  const isSchemaValid = useMemo(() => validateJsonSchema(jsonSchema), [jsonSchema])
  const isCodeValid = useMemo(() => validateFunctionCode(functionCode), [functionCode])

  const handleSave = () => {
    setSchemaError(null)
    setCodeError(null)

    // Validation with error messages
    if (!jsonSchema) {
      setSchemaError('Schema cannot be empty')
      setActiveSection('schema')
      return
    }

    try {
      const parsed = JSON.parse(jsonSchema)

      if (!parsed.type || parsed.type !== 'function') {
        setSchemaError('Schema must have a "type" field set to "function"')
        setActiveSection('schema')
        return
      }

      if (!parsed.function || !parsed.function.name) {
        setSchemaError('Schema must have a "function" object with a "name" field')
        setActiveSection('schema')
        return
      }

      // Check for duplicate tool name
      const toolName = parsed.function.name
      const existingTools = useCustomToolsStore.getState().getAllTools()

      // If editing, we need to find the original tool to get its ID
      let originalToolId = toolId

      if (isEditing && !originalToolId) {
        // If we're editing but don't have an ID, try to find the tool by its original name
        const originalSchema = initialValues?.schema
        const originalName = originalSchema?.function?.name

        if (originalName) {
          const originalTool = existingTools.find(
            (tool) => tool.schema.function.name === originalName
          )
          if (originalTool) {
            originalToolId = originalTool.id
          }
        }
      }

      // Check for duplicates, excluding the current tool if editing
      const isDuplicate = existingTools.some((tool) => {
        // Skip the current tool when checking for duplicates
        if (isEditing && tool.id === originalToolId) {
          return false
        }
        return tool.schema.function.name === toolName
      })

      if (isDuplicate) {
        setSchemaError(`A tool with the name "${toolName}" already exists`)
        setActiveSection('schema')
        return
      }

      // Save to custom tools store
      const schema = JSON.parse(jsonSchema)
      const name = schema.function.name
      const description = schema.function.description || ''

      if (isEditing && originalToolId) {
        // Update existing tool
        updateTool(originalToolId, {
          title: name,
          schema,
          code: functionCode || '',
        })
      } else {
        // Add new tool
        originalToolId = addTool({
          title: name,
          schema,
          code: functionCode || '',
        })
      }

      const customTool: CustomTool = {
        type: 'custom-tool',
        title: name,
        name,
        description,
        schema,
        code: functionCode || '',
        params: {},
        isExpanded: true,
      }

      onSave(customTool)
      handleClose()
    } catch (error) {
      logger.error('Error saving custom tool:', { error })
      setSchemaError('Failed to save custom tool. Please check your inputs and try again.')
    }
  }

  const handleJsonSchemaChange = (value: string) => {
    setJsonSchema(value)
    if (schemaError) {
      setSchemaError(null)
    }
  }

  const handleFunctionCodeChange = (value: string) => {
    setFunctionCode(value)
    if (codeError) {
      setCodeError(null)
    }

    // Check for environment variables and tags
    const textarea = codeEditorRef.current?.querySelector('textarea')
    if (textarea) {
      const pos = textarea.selectionStart
      setCursorPosition(pos)

      // Calculate cursor position for dropdowns
      const textBeforeCursor = value.substring(0, pos)
      const lines = textBeforeCursor.split('\n')
      const currentLine = lines.length
      const currentCol = lines[lines.length - 1].length

      // Find position of cursor in the editor
      try {
        if (codeEditorRef.current) {
          const editorRect = codeEditorRef.current.getBoundingClientRect()
          const lineHeight = 21 // Same as in CodeEditor

          // Calculate approximate position
          const top = currentLine * lineHeight + 5
          const left = Math.min(currentCol * 8, editorRect.width - 260) // Prevent dropdown from going off-screen

          setDropdownPosition({ top, left })
        }
      } catch (error) {
        logger.error('Error calculating cursor position:', { error })
      }

      // Check if we should show the environment variables dropdown
      const envVarTrigger = checkEnvVarTrigger(value, pos)
      setShowEnvVars(envVarTrigger.show)
      setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')

      // Check if we should show the tags dropdown
      const tagTrigger = checkTagTrigger(value, pos)
      setShowTags(tagTrigger.show)
      if (!tagTrigger.show) {
        setActiveSourceBlockId(null)
      }
    }
  }

  // Handle environment variable selection
  const handleEnvVarSelect = (newValue: string) => {
    setFunctionCode(newValue)
    setShowEnvVars(false)
  }

  // Handle tag selection
  const handleTagSelect = (newValue: string) => {
    setFunctionCode(newValue)
    setShowTags(false)
    setActiveSourceBlockId(null)
  }

  // Handle key press events
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Only handle Escape directly if dropdowns aren't visible
    // Otherwise, let the dropdowns handle their own keyboard events
    if (e.key === 'Escape' && !showEnvVars && !showTags) {
      setShowEnvVars(false)
      setShowTags(false)
    }

    // Don't handle other keys when dropdowns are visible
    if (showEnvVars || showTags) {
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
  }

  const navigationItems = [
    {
      id: 'schema' as const,
      label: 'Schema',
      icon: FileJson,
      complete: isSchemaValid,
    },
    {
      id: 'code' as const,
      label: 'Code',
      icon: Code,
      complete: isCodeValid,
    },
  ]

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] h-[80vh] flex flex-col p-0 gap-0" hideCloseButton>
        <DialogHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-medium">
              {isEditing ? 'Edit Agent Tool' : 'Create Agent Tool'}
            </DialogTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8 p-0" onClick={handleClose}>
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
          <DialogDescription className="mt-1.5">
            Step {activeSection === 'schema' ? '1' : '2'} of 2:{' '}
            {activeSection === 'schema' ? 'Define schema' : 'Implement code'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex border-b">
            {navigationItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  'flex items-center gap-2 px-6 py-3 text-sm transition-colors border-b-2',
                  'hover:bg-muted/50',
                  activeSection === item.id
                    ? 'border-primary text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          <div className="flex-1 px-6 pt-6 pb-12 overflow-auto">
            <div
              className={cn(
                'flex-1 flex flex-col h-full',
                activeSection === 'schema' ? 'block' : 'hidden'
              )}
            >
              <div className="flex items-center mb-1 min-h-6">
                <div className="flex items-center gap-2">
                  <FileJson className="h-4 w-4" />
                  <Label htmlFor="json-schema" className="font-medium">
                    JSON Schema
                  </Label>
                </div>
                {schemaError && (
                  <span className="text-sm text-red-600 ml-4 flex-shrink-0">{schemaError}</span>
                )}
              </div>
              <CodeEditor
                value={jsonSchema}
                onChange={handleJsonSchemaChange}
                language="json"
                placeholder={`{
  "type": "function",
  "function": {
    "name": "addItemToOrder",
    "description": "Add one quantity of a food item to the order.",
    "parameters": {
      "type": "object",
      "properties": {
        "itemName": {
          "type": "string",
          "description": "The name of the food item to add to order"
        }
      },
      "required": ["itemName"]
    }
  }
}`}
                minHeight="340px"
                className={cn(schemaError ? 'border-red-500' : '')}
              />
              <div className="h-6"></div>
            </div>

            <div
              className={cn(
                'flex-1 flex flex-col h-full pb-6',
                activeSection === 'code' ? 'block' : 'hidden'
              )}
            >
              <div className="flex items-center mb-1 min-h-6">
                <div className="flex items-center gap-2">
                  <Code className="h-4 w-4" />
                  <Label htmlFor="function-code" className="font-medium">
                    Code (optional)
                  </Label>
                </div>
                {codeError && (
                  <span className="text-sm text-red-600 ml-4 flex-shrink-0">{codeError}</span>
                )}
              </div>
              <div ref={codeEditorRef} className="relative">
                <CodeEditor
                  value={functionCode}
                  onChange={handleFunctionCodeChange}
                  language="javascript"
                  placeholder={`// This code will be executed when the tool is called. You can use environment variables with {{VARIABLE_NAME}}.`}
                  minHeight="340px"
                  className={cn(codeError ? 'border-red-500' : '')}
                  highlightVariables={true}
                  onKeyDown={handleKeyDown}
                />

                {/* Environment variables dropdown */}
                {showEnvVars && (
                  <EnvVarDropdown
                    visible={showEnvVars}
                    onSelect={handleEnvVarSelect}
                    searchTerm={searchTerm}
                    inputValue={functionCode}
                    cursorPosition={cursorPosition}
                    onClose={() => {
                      setShowEnvVars(false)
                      setSearchTerm('')
                    }}
                    className="w-64"
                    style={{
                      position: 'absolute',
                      top: `${dropdownPosition.top}px`,
                      left: `${dropdownPosition.left}px`,
                    }}
                  />
                )}

                {/* Tags dropdown */}
                {showTags && (
                  <TagDropdown
                    visible={showTags}
                    onSelect={handleTagSelect}
                    blockId=""
                    activeSourceBlockId={activeSourceBlockId}
                    inputValue={functionCode}
                    cursorPosition={cursorPosition}
                    onClose={() => {
                      setShowTags(false)
                      setActiveSourceBlockId(null)
                    }}
                    className="w-64"
                    style={{
                      position: 'absolute',
                      top: `${dropdownPosition.top}px`,
                      left: `${dropdownPosition.left}px`,
                    }}
                  />
                )}
              </div>
              <div className="h-6"></div>
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t mt-auto">
          <div className="flex justify-between w-full">
            <Button
              variant="outline"
              onClick={() => {
                if (activeSection === 'code') {
                  setActiveSection('schema')
                }
              }}
              disabled={activeSection === 'schema'}
            >
              Back
            </Button>
            <div className="flex space-x-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              {activeSection === 'schema' ? (
                <Button onClick={() => setActiveSection('code')} disabled={!isSchemaValid}>
                  Next
                </Button>
              ) : (
                <Button onClick={handleSave}>{isEditing ? 'Update Tool' : 'Save Tool'}</Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
