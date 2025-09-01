import { useEffect, useMemo, useRef, useState } from 'react'
import { Code, FileJson, Trash2, Wand2, X } from 'lucide-react'
import { useParams } from 'next/navigation'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { WandPromptBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/wand-prompt-bar/wand-prompt-bar'
import { CodeEditor } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/tool-input/components/code-editor/code-editor'
import { useWand } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-wand'
import { useCustomToolsStore } from '@/stores/custom-tools/store'

const logger = createLogger('CustomToolModal')

interface CustomToolModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (tool: CustomTool) => void
  onDelete?: (toolId: string) => void
  blockId: string
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
  blockId,
  initialValues,
}: CustomToolModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [activeSection, setActiveSection] = useState<ToolSection>('schema')
  const [jsonSchema, setJsonSchema] = useState('')
  const [functionCode, setFunctionCode] = useState('')
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [toolId, setToolId] = useState<string | undefined>(undefined)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // AI Code Generation Hooks
  const schemaGeneration = useWand({
    wandConfig: {
      enabled: true,
      maintainHistory: true,
      prompt: `You are an expert programmer specializing in creating OpenAI function calling format JSON schemas for custom tools.
Generate ONLY the JSON schema based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.
The JSON schema MUST follow this specific format:
1. Top-level property "type" must be set to "function"
2. A "function" object containing:
   - "name": A concise, camelCase name for the function
   - "description": A clear description of what the function does
   - "parameters": A JSON Schema object describing the function's parameters with:
     - "type": "object"
     - "properties": An object containing parameter definitions
     - "required": An array of required parameter names

Current schema: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.

Valid Schema Examples:

Example 1:
{
  "type": "function",
  "function": {
    "name": "getWeather",
    "description": "Fetches the current weather for a specific location.",
    "parameters": {
      "type": "object",
      "properties": {
        "location": {
          "type": "string",
          "description": "The city and state, e.g., San Francisco, CA"
        },
        "unit": {
          "type": "string",
          "description": "Temperature unit",
          "enum": ["celsius", "fahrenheit"]
        }
      },
      "required": ["location"],
      "additionalProperties": false
    }
  }
}

Example 2:
{
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
        },
        "quantity": {
          "type": "integer",
          "description": "The quantity of the item to add",
          "default": 1
        }
      },
      "required": ["itemName"],
      "additionalProperties": false
    }
  }
}`,
      placeholder: 'Describe the function parameters and structure...',
      generationType: 'custom-tool-schema',
    },
    currentValue: jsonSchema,
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

  const codeGeneration = useWand({
    wandConfig: {
      enabled: true,
      maintainHistory: true,
      prompt: `You are an expert JavaScript programmer.
Generate ONLY the raw body of a JavaScript function based on the user's request.
The code should be executable within an 'async function(params, environmentVariables) {...}' context.
- 'params' (object): Contains input parameters derived from the JSON schema. Access these directly using the parameter name wrapped in angle brackets, e.g., '<paramName>'. Do NOT use 'params.paramName'.
- 'environmentVariables' (object): Contains environment variables. Reference these using the double curly brace syntax: '{{ENV_VAR_NAME}}'. Do NOT use 'environmentVariables.VAR_NAME' or env.

Current code: {context}

IMPORTANT FORMATTING RULES:
1. Reference Environment Variables: Use the exact syntax {{VARIABLE_NAME}}. Do NOT wrap it in quotes (e.g., use 'apiKey = {{SERVICE_API_KEY}}' not 'apiKey = "{{SERVICE_API_KEY}}"'). Our system replaces these placeholders before execution.
2. Reference Input Parameters/Workflow Variables: Use the exact syntax <variable_name>. Do NOT wrap it in quotes (e.g., use 'userId = <userId>;' not 'userId = "<userId>";'). This includes parameters defined in the block's schema and outputs from previous blocks.
3. Function Body ONLY: Do NOT include the function signature (e.g., 'async function myFunction() {' or the surrounding '}').
4. Imports: Do NOT include import/require statements unless they are standard Node.js built-in modules (e.g., 'crypto', 'fs'). External libraries are not supported in this context.
5. Output: Ensure the code returns a value if the function is expected to produce output. Use 'return'.
6. Clarity: Write clean, readable code.
7. No Explanations: Do NOT include markdown formatting, comments explaining the rules, or any text other than the raw JavaScript code for the function body.

Example Scenario:
User Prompt: "Fetch user data from an API. Use the User ID passed in as 'userId' and an API Key stored as the 'SERVICE_API_KEY' environment variable."

Generated Code:
const userId = <block.content>; // Correct: Accessing input parameter without quotes
const apiKey = {{SERVICE_API_KEY}}; // Correct: Accessing environment variable without quotes
const url = \`https://api.example.com/users/\${userId}\`;

try {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': \`Bearer \${apiKey}\`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    // Throwing an error will mark the block execution as failed
    throw new Error(\`API request failed with status \${response.status}: \${await response.text()}\`);
  }

  const data = await response.json();
  console.log('User data fetched successfully.'); // Optional: logging for debugging
  return data; // Return the fetched data which becomes the block's output
} catch (error) {
  console.error(\`Error fetching user data: \${error.message}\`);
  // Re-throwing the error ensures the workflow knows this step failed.
  throw error;
}`,
      placeholder: 'Describe the JavaScript function to generate...',
      generationType: 'javascript-function-body',
    },
    currentValue: functionCode,
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
  const [showSchemaParams, setShowSchemaParams] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const codeEditorRef = useRef<HTMLDivElement>(null)
  const schemaParamsDropdownRef = useRef<HTMLDivElement>(null)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  // Add state for dropdown positioning
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
  // Schema params keyboard navigation
  const [schemaParamSelectedIndex, setSchemaParamSelectedIndex] = useState(0)

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

  // Close schema params dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        schemaParamsDropdownRef.current &&
        !schemaParamsDropdownRef.current.contains(event.target as Node)
      ) {
        setShowSchemaParams(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

      // Validate that parameters object exists with correct structure
      if (!parsed.function.parameters) {
        return false
      }

      if (!parsed.function.parameters.type || parsed.function.parameters.properties === undefined) {
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

  // Extract parameters from JSON schema for autocomplete
  const schemaParameters = useMemo(() => {
    try {
      if (!jsonSchema) return []
      const parsed = JSON.parse(jsonSchema)
      const properties = parsed?.function?.parameters?.properties
      if (!properties) return []

      return Object.keys(properties).map((key) => ({
        name: key,
        type: properties[key].type || 'any',
        description: properties[key].description || '',
        required: parsed?.function?.parameters?.required?.includes(key) || false,
      }))
    } catch {
      return []
    }
  }, [jsonSchema])

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

      // Validate parameters structure - must be present
      if (!parsed.function.parameters) {
        setSchemaError('Missing function.parameters object')
        setActiveSection('schema')
        return
      }

      if (!parsed.function.parameters.type) {
        setSchemaError('Missing parameters.type field')
        setActiveSection('schema')
        return
      }

      if (parsed.function.parameters.properties === undefined) {
        setSchemaError('Missing parameters.properties field')
        setActiveSection('schema')
        return
      }

      if (
        typeof parsed.function.parameters.properties !== 'object' ||
        parsed.function.parameters.properties === null
      ) {
        setSchemaError('parameters.properties must be an object')
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

    // Real-time validation - show error immediately when schema is invalid
    if (value.trim()) {
      try {
        const parsed = JSON.parse(value)

        if (!parsed.type || parsed.type !== 'function') {
          setSchemaError('Missing "type": "function"')
          return
        }

        if (!parsed.function || !parsed.function.name) {
          setSchemaError('Missing function.name field')
          return
        }

        if (!parsed.function.parameters) {
          setSchemaError('Missing function.parameters object')
          return
        }

        if (!parsed.function.parameters.type) {
          setSchemaError('Missing parameters.type field')
          return
        }

        if (parsed.function.parameters.properties === undefined) {
          setSchemaError('Missing parameters.properties field')
          return
        }

        if (
          typeof parsed.function.parameters.properties !== 'object' ||
          parsed.function.parameters.properties === null
        ) {
          setSchemaError('parameters.properties must be an object')
          return
        }

        // Schema is valid, clear any existing error
        setSchemaError(null)
      } catch {
        setSchemaError('Invalid JSON format')
      }
    } else {
      // Clear error when schema is empty (will be caught during save)
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

      // Show/hide schema parameters dropdown based on typing context
      if (!codeGeneration.isStreaming && schemaParameters.length > 0) {
        const schemaParamTrigger = checkSchemaParamTrigger(value, pos, schemaParameters)
        if (schemaParamTrigger.show && !showSchemaParams) {
          setShowSchemaParams(true)
          setSchemaParamSelectedIndex(0)
        } else if (!schemaParamTrigger.show && showSchemaParams) {
          setShowSchemaParams(false)
        }
      }
    }
  }

  // Function to check if we should show schema parameters dropdown
  const checkSchemaParamTrigger = (text: string, cursorPos: number, parameters: any[]) => {
    if (parameters.length === 0) return { show: false, searchTerm: '' }

    // Look for partial parameter names after common patterns like 'const ', '= ', etc.
    const beforeCursor = text.substring(0, cursorPos)
    const words = beforeCursor.split(/[\s=();,{}[\]]+/)
    const currentWord = words[words.length - 1] || ''

    // Show dropdown if typing and current word could be a parameter
    if (currentWord.length > 0 && /^[a-zA-Z_][\w]*$/.test(currentWord)) {
      const matchingParams = parameters.filter((param) =>
        param.name.toLowerCase().startsWith(currentWord.toLowerCase())
      )
      return { show: matchingParams.length > 0, searchTerm: currentWord, matches: matchingParams }
    }

    return { show: false, searchTerm: '' }
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

  // Handle schema parameter selection
  const handleSchemaParamSelect = (paramName: string) => {
    const textarea = codeEditorRef.current?.querySelector('textarea')
    if (textarea) {
      const pos = textarea.selectionStart
      const beforeCursor = functionCode.substring(0, pos)
      const afterCursor = functionCode.substring(pos)

      // Find the start of the current word
      const words = beforeCursor.split(/[\s=();,{}[\]]+/)
      const currentWord = words[words.length - 1] || ''
      const wordStart = beforeCursor.lastIndexOf(currentWord)

      // Replace the current partial word with the selected parameter
      const newValue = beforeCursor.substring(0, wordStart) + paramName + afterCursor
      setFunctionCode(newValue)
      setShowSchemaParams(false)

      // Set cursor position after the inserted parameter
      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(wordStart + paramName.length, wordStart + paramName.length)
      }, 0)
    }
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
      // Close dropdowns first, only close modal if no dropdowns are open
      if (showEnvVars || showTags || showSchemaParams) {
        setShowEnvVars(false)
        setShowTags(false)
        setShowSchemaParams(false)
        e.preventDefault()
        e.stopPropagation()
        return
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

    // Handle schema parameters dropdown keyboard navigation
    if (showSchemaParams && schemaParameters.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          setSchemaParamSelectedIndex((prev) => Math.min(prev + 1, schemaParameters.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          setSchemaParamSelectedIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          e.stopPropagation()
          if (schemaParamSelectedIndex >= 0 && schemaParamSelectedIndex < schemaParameters.length) {
            const selectedParam = schemaParameters[schemaParamSelectedIndex]
            handleSchemaParamSelect(selectedParam.name)
          }
          break
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          setShowSchemaParams(false)
          break
      }
      return // Don't handle other dropdown events when schema params is active
    }

    // Let other dropdowns handle their own keyboard events if visible
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
          onKeyDown={(e) => {
            // Intercept Escape key when dropdowns are open
            if (e.key === 'Escape' && (showEnvVars || showTags || showSchemaParams)) {
              e.preventDefault()
              e.stopPropagation()
              setShowEnvVars(false)
              setShowTags(false)
              setShowSchemaParams(false)
            }
          }}
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
                <WandPromptBar
                  isVisible={schemaGeneration.isPromptVisible}
                  isLoading={schemaGeneration.isLoading}
                  isStreaming={schemaGeneration.isStreaming}
                  promptValue={schemaGeneration.promptInputValue}
                  onSubmit={(prompt: string) => schemaGeneration.generateStream({ prompt })}
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
                <WandPromptBar
                  isVisible={codeGeneration.isPromptVisible}
                  isLoading={codeGeneration.isLoading}
                  isStreaming={codeGeneration.isStreaming}
                  promptValue={codeGeneration.promptInputValue}
                  onSubmit={(prompt: string) => codeGeneration.generateStream({ prompt })}
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
                      <div className='ml-4 break-words text-red-600 text-sm'>{schemaError}</div>
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
                      <div className='ml-4 break-words text-red-600 text-sm'>{codeError}</div>
                    )}
                </div>
                {schemaParameters.length > 0 && (
                  <div className='mb-2 rounded-md bg-muted/50 p-2'>
                    <p className='text-muted-foreground text-xs'>
                      <span className='font-medium'>Available parameters:</span>{' '}
                      {schemaParameters.map((param, index) => (
                        <span key={param.name}>
                          <code className='rounded bg-background px-1 py-0.5 text-foreground'>
                            {param.name}
                          </code>
                          {index < schemaParameters.length - 1 && ', '}
                        </span>
                      ))}
                      {'. '}Start typing a parameter name for autocomplete.
                    </p>
                  </div>
                )}
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
                    schemaParameters={schemaParameters} // Pass schema parameters for highlighting
                  />

                  {/* Environment variables dropdown */}
                  {showEnvVars && (
                    <EnvVarDropdown
                      visible={showEnvVars}
                      onSelect={handleEnvVarSelect}
                      searchTerm={searchTerm}
                      inputValue={functionCode}
                      cursorPosition={cursorPosition}
                      workspaceId={workspaceId}
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
                      blockId={blockId}
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

                  {/* Schema parameters dropdown */}
                  {showSchemaParams && schemaParameters.length > 0 && (
                    <div
                      ref={schemaParamsDropdownRef}
                      className='absolute z-[9999] mt-1 w-64 overflow-visible rounded-md border bg-popover shadow-md'
                      style={{
                        top: `${dropdownPosition.top}px`,
                        left: `${dropdownPosition.left}px`,
                      }}
                    >
                      <div className='py-1'>
                        <div className='px-2 pt-2.5 pb-0.5 font-medium text-muted-foreground text-xs'>
                          Available Parameters
                        </div>
                        <div>
                          {schemaParameters.map((param, index) => (
                            <button
                              key={param.name}
                              onClick={() => handleSchemaParamSelect(param.name)}
                              onMouseEnter={() => setSchemaParamSelectedIndex(index)}
                              className={cn(
                                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                                'hover:bg-accent hover:text-accent-foreground',
                                'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                                index === schemaParamSelectedIndex &&
                                  'bg-accent text-accent-foreground'
                              )}
                            >
                              <div
                                className='flex h-5 w-5 items-center justify-center rounded'
                                style={{ backgroundColor: '#2F8BFF' }}
                              >
                                <span className='h-3 w-3 font-bold text-white text-xs'>P</span>
                              </div>
                              <span className='flex-1 truncate'>{param.name}</span>
                              <span className='text-muted-foreground text-xs'>{param.type}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
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
                  <Button
                    onClick={() => setActiveSection('code')}
                    disabled={!isSchemaValid || !!schemaError}
                  >
                    Next
                  </Button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button onClick={handleSave} disabled={!isSchemaValid}>
                          {isEditing ? 'Update Tool' : 'Save Tool'}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!isSchemaValid && (
                      <TooltipContent side='top'>
                        <p>Invalid JSON schema</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
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
