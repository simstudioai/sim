import { useEffect, useMemo, useRef, useState } from 'react'
import { Code, FileJson, Trash2, Wand2, X } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useCodeGeneration } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-code-generation'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import { CodePromptBar } from '../../../../../../../code-prompt-bar/code-prompt-bar'
import { CodeEditor } from '../code-editor/code-editor'

const logger = createLogger('CustomToolModal')

interface CustomToolModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (tool: CustomTool) => void
  onDelete?: (toolId: string) => void
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
  onDelete,
  initialValues,
}: CustomToolModalProps) {
  const [activeSection, setActiveSection] = useState<ToolSection>('schema')
  const [jsonSchema, setJsonSchema] = useState('')
  const [functionCode, setFunctionCode] = useState('')
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [toolId, setToolId] = useState<string | undefined>(undefined)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // AI Code Generation Hooks
  const schemaGeneration = useCodeGeneration({
    generationType: 'custom-tool-schema',
    onGeneratedContent: (content) => {
      handleJsonSchemaChange(content)
      setSchemaError(null) // Clear error on successful generation
    },
    onStreamChunk: (chunk) => {
      setJsonSchema((prev) => {
        const newSchema = prev + chunk
        // Clear error as soon as streaming starts
        if (schemaError) setSchemaError(null)
        return newSchema
      })
    },
  })

  const codeGeneration = useCodeGeneration({
    generationType: 'javascript-function-body',
    onGeneratedContent: (content) => {
      handleFunctionCodeChange(content) // Use existing handler to also trigger dropdown checks
      setCodeError(null) // Clear error on successful generation
    },
    onStreamChunk: (chunk) => {
      setFunctionCode((prev) => {
        const newCode = prev + chunk
        // Use existing handler logic for consistency, though dropdowns might be disabled during streaming
        handleFunctionCodeChange(newCode)
        // Clear error as soon as streaming starts
        if (codeError) setCodeError(null)
        return newCode
      })
    },
  })

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
  const removeTool = useCustomToolsStore((state) => state.removeTool)

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
    // Reset AI state as well
    schemaGeneration.closePrompt()
    schemaGeneration.hidePromptInline()
    codeGeneration.closePrompt()
    codeGeneration.hidePromptInline()
  }

  const handleClose = () => {
    // Cancel any ongoing generation before closing
    if (schemaGeneration.isStreaming) schemaGeneration.cancelGeneration()
    if (codeGeneration.isStreaming) codeGeneration.cancelGeneration()
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
    } catch (_error) {
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
      const customToolsStore = useCustomToolsStore.getState()
      const existingTools = customToolsStore.getAllTools()

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

      let _finalToolId: string | undefined = originalToolId

      // Only save to the store if we're not reusing an existing tool
      if (isEditing && originalToolId) {
        // Update existing tool in store
        updateTool(originalToolId, {
          title: name,
          schema,
          code: functionCode || '',
        })
      } else {
        // Add new tool to store
        _finalToolId = addTool({
          title: name,
          schema,
          code: functionCode || '',
        })
      }

      // Create the custom tool object for the parent component
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

      // Pass the tool to parent component
      onSave(customTool)

      // Close the modal
      handleClose()
    } catch (error) {
      logger.error('Error saving custom tool:', { error })
      setSchemaError('Failed to save custom tool. Please check your inputs and try again.')
    }
  }

  const handleJsonSchemaChange = (value: string) => {
    // Prevent updates during AI generation/streaming
    if (schemaGeneration.isLoading || schemaGeneration.isStreaming) return
    setJsonSchema(value)
    if (schemaError) {
      setSchemaError(null)
    }
  }

  const handleFunctionCodeChange = (value: string) => {
    // Prevent updates during AI generation/streaming
    if (codeGeneration.isLoading || codeGeneration.isStreaming) {
      // We still need to update the state for streaming chunks, but skip dropdown logic
      setFunctionCode(value)
      if (codeError) {
        setCodeError(null)
      }
      return
    }

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
      setShowEnvVars(envVarTrigger.show && !codeGeneration.isStreaming) // Hide dropdown during streaming
      setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')

      // Check if we should show the tags dropdown
      const tagTrigger = checkTagTrigger(value, pos)
      setShowTags(tagTrigger.show && !codeGeneration.isStreaming) // Hide dropdown during streaming
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
    // Allow AI prompt interaction (e.g., Escape to close prompt bar)
    // Check if AI prompt is visible for the current section
    const isSchemaPromptVisible = activeSection === 'schema' && schemaGeneration.isPromptVisible
    const isCodePromptVisible = activeSection === 'code' && codeGeneration.isPromptVisible

    if (e.key === 'Escape') {
      if (isSchemaPromptVisible) {
        schemaGeneration.hidePromptInline()
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (isCodePromptVisible) {
        codeGeneration.hidePromptInline()
        e.preventDefault()
        e.stopPropagation()
        return
      }
      // Close dropdowns only if AI prompt isn't active
      if (!showEnvVars && !showTags) {
        setShowEnvVars(false)
        setShowTags(false)
      }
    }

    // Prevent regular input if streaming in the active section
    if (activeSection === 'schema' && schemaGeneration.isStreaming) {
      e.preventDefault()
      return
    }
    if (activeSection === 'code' && codeGeneration.isStreaming) {
      e.preventDefault()
      return
    }

    // Let dropdowns handle their own keyboard events if visible
    if (showEnvVars || showTags) {
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
  }

  const handleDelete = async () => {
    if (!toolId || !isEditing) return

    try {
      setShowDeleteConfirm(false)

      // Call API to delete the tool
      const response = await fetch(`/api/tools/custom?id=${toolId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMessage = errorData.error || response.statusText || 'Failed to delete tool'
        throw new Error(errorMessage)
      }

      // Remove from local store
      removeTool(toolId)
      logger.info(`Deleted tool: ${toolId}`)

      // Notify parent component if callback provided
      if (onDelete) {
        onDelete(toolId)
      }

      // Close the modal
      handleClose()
    } catch (error) {
      logger.error('Error deleting custom tool:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete custom tool'
      setSchemaError(`${errorMessage}. Please try again.`)
      setActiveSection('schema') // Switch to schema tab to show the error
      setShowDeleteConfirm(false) // Close the confirmation dialog
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
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent
          className='flex h-[80vh] flex-col gap-0 p-0 sm:max-w-[700px]'
          hideCloseButton
        >
          <DialogHeader className='border-b px-6 py-4'>
            <div className='flex items-center justify-between'>
              <DialogTitle className='font-medium text-lg'>
                {isEditing ? 'Edit Agent Tool' : 'Create Agent Tool'}
              </DialogTitle>
              <Button variant='ghost' size='icon' className='h-8 w-8 p-0' onClick={handleClose}>
                <X className='h-4 w-4' />
                <span className='sr-only'>Close</span>
              </Button>
            </div>
            <DialogDescription className='mt-1.5'>
              Step {activeSection === 'schema' ? '1' : '2'} of 2:{' '}
              {activeSection === 'schema' ? 'Define schema' : 'Implement code'}
            </DialogDescription>
          </DialogHeader>

          <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
            <div className='flex border-b'>
              {navigationItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={cn(
                    'flex items-center gap-2 border-b-2 px-6 py-3 text-sm transition-colors',
                    'hover:bg-muted/50',
                    activeSection === item.id
                      ? 'border-primary font-medium text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  <item.icon className='h-4 w-4' />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            <div className='relative flex-1 overflow-auto px-6 pt-6 pb-12'>
              {/* Schema Section AI Prompt Bar */}
              {activeSection === 'schema' && (
                <CodePromptBar
                  isVisible={schemaGeneration.isPromptVisible}
                  isLoading={schemaGeneration.isLoading}
                  isStreaming={schemaGeneration.isStreaming}
                  promptValue={schemaGeneration.promptInputValue}
                  onSubmit={(prompt: string) =>
                    schemaGeneration.generateStream({ prompt, context: jsonSchema })
                  }
                  onCancel={
                    schemaGeneration.isStreaming
                      ? schemaGeneration.cancelGeneration
                      : schemaGeneration.hidePromptInline
                  }
                  onChange={schemaGeneration.updatePromptValue}
                  placeholder='Describe the JSON schema to generate...'
                  className='!top-0 relative mb-2'
                />
              )}

              {/* Code Section AI Prompt Bar */}
              {activeSection === 'code' && (
                <CodePromptBar
                  isVisible={codeGeneration.isPromptVisible}
                  isLoading={codeGeneration.isLoading}
                  isStreaming={codeGeneration.isStreaming}
                  promptValue={codeGeneration.promptInputValue}
                  onSubmit={(prompt: string) =>
                    codeGeneration.generateStream({ prompt, context: functionCode })
                  }
                  onCancel={
                    codeGeneration.isStreaming
                      ? codeGeneration.cancelGeneration
                      : codeGeneration.hidePromptInline
                  }
                  onChange={codeGeneration.updatePromptValue}
                  placeholder='Describe the JavaScript code to generate...'
                  className='!top-0 relative mb-2'
                />
              )}

              <div
                className={cn(
                  'flex h-full flex-1 flex-col',
                  activeSection === 'schema' ? 'block' : 'hidden'
                )}
              >
                <div className='mb-1 flex min-h-6 items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <FileJson className='h-4 w-4' />
                    <Label htmlFor='json-schema' className='font-medium'>
                      JSON Schema
                    </Label>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-5 w-5 rounded-full border border-transparent bg-muted/80 p-0 text-muted-foreground shadow-sm transition-all duration-200 hover:border-primary/20 hover:bg-muted hover:text-primary hover:shadow'
                      onClick={() => {
                        logger.debug('Schema AI button clicked')
                        logger.debug(
                          'showPromptInline function exists:',
                          typeof schemaGeneration.showPromptInline === 'function'
                        )
                        schemaGeneration.isPromptVisible
                          ? schemaGeneration.hidePromptInline()
                          : schemaGeneration.showPromptInline()
                      }}
                      disabled={schemaGeneration.isLoading || schemaGeneration.isStreaming}
                      aria-label='Generate schema with AI'
                    >
                      <Wand2 className='h-3 w-3' />
                    </Button>
                  </div>
                  {schemaError &&
                    !schemaGeneration.isStreaming && ( // Hide schema error while streaming
                      <span className='ml-4 flex-shrink-0 text-red-600 text-sm'>{schemaError}</span>
                    )}
                </div>
                <CodeEditor
                  value={jsonSchema}
                  onChange={handleJsonSchemaChange}
                  language='json'
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
                  minHeight='360px'
                  className={cn(
                    schemaError && !schemaGeneration.isStreaming ? 'border-red-500' : '',
                    (schemaGeneration.isLoading || schemaGeneration.isStreaming) &&
                      'cursor-not-allowed opacity-50'
                  )}
                  disabled={schemaGeneration.isLoading || schemaGeneration.isStreaming} // Use disabled prop instead of readOnly
                  onKeyDown={handleKeyDown} // Pass keydown handler
                />
                <div className='h-6' />
              </div>

              <div
                className={cn(
                  'flex h-full flex-1 flex-col pb-6',
                  activeSection === 'code' ? 'block' : 'hidden'
                )}
              >
                <div className='mb-1 flex min-h-6 items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <Code className='h-4 w-4' />
                    <Label htmlFor='function-code' className='font-medium'>
                      Code (optional)
                    </Label>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-5 w-5 rounded-full border border-transparent bg-muted/80 p-0 text-muted-foreground shadow-sm transition-all duration-200 hover:border-primary/20 hover:bg-muted hover:text-primary hover:shadow'
                      onClick={() => {
                        logger.debug('Code AI button clicked')
                        logger.debug(
                          'showPromptInline function exists:',
                          typeof codeGeneration.showPromptInline === 'function'
                        )
                        codeGeneration.isPromptVisible
                          ? codeGeneration.hidePromptInline()
                          : codeGeneration.showPromptInline()
                      }}
                      disabled={codeGeneration.isLoading || codeGeneration.isStreaming}
                      aria-label='Generate code with AI'
                    >
                      <Wand2 className='h-3 w-3' />
                    </Button>
                  </div>
                  {codeError &&
                    !codeGeneration.isStreaming && ( // Hide code error while streaming
                      <span className='ml-4 flex-shrink-0 text-red-600 text-sm'>{codeError}</span>
                    )}
                </div>
                <div ref={codeEditorRef} className='relative'>
                  <CodeEditor
                    value={functionCode}
                    onChange={handleFunctionCodeChange}
                    language='javascript'
                    placeholder={
                      '// This code will be executed when the tool is called. You can use environment variables with {{VARIABLE_NAME}}.'
                    }
                    minHeight='360px'
                    className={cn(
                      codeError && !codeGeneration.isStreaming ? 'border-red-500' : '',
                      (codeGeneration.isLoading || codeGeneration.isStreaming) &&
                        'cursor-not-allowed opacity-50'
                    )}
                    highlightVariables={true}
                    disabled={codeGeneration.isLoading || codeGeneration.isStreaming} // Use disabled prop instead of readOnly
                    onKeyDown={handleKeyDown} // Pass keydown handler
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
                      className='w-64'
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
                      blockId=''
                      activeSourceBlockId={activeSourceBlockId}
                      inputValue={functionCode}
                      cursorPosition={cursorPosition}
                      onClose={() => {
                        setShowTags(false)
                        setActiveSourceBlockId(null)
                      }}
                      className='w-64'
                      style={{
                        position: 'absolute',
                        top: `${dropdownPosition.top}px`,
                        left: `${dropdownPosition.left}px`,
                      }}
                    />
                  )}
                </div>
                <div className='h-6' />
              </div>
            </div>
          </div>

          <DialogFooter className='mt-auto border-t px-6 py-4'>
            <div className='flex w-full justify-between'>
              {isEditing ? (
                <Button
                  variant='destructive'
                  size='sm'
                  onClick={() => setShowDeleteConfirm(true)}
                  className='gap-1'
                >
                  <Trash2 className='h-4 w-4' />
                  Delete
                </Button>
              ) : (
                <Button
                  variant='outline'
                  onClick={() => {
                    if (activeSection === 'code') {
                      setActiveSection('schema')
                    }
                  }}
                  disabled={activeSection === 'schema'}
                >
                  Back
                </Button>
              )}
              <div className='flex space-x-2'>
                <Button variant='outline' onClick={handleClose}>
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete this tool?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the tool and remove it from
              any workflows that are using it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
