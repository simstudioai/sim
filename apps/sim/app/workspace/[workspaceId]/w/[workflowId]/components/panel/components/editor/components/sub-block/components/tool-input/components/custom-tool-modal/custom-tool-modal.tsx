import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Code, FileJson, Wand2, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button as EmcnButton,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverSection,
} from '@/components/emcn'
import { Trash } from '@/components/emcn/icons/trash'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import {
  checkEnvVarTrigger,
  EnvVarDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'
import {
  checkTagTrigger,
  TagDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { CodeEditor } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/components/code-editor/code-editor'
import { useWand } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-wand'
import {
  useCreateCustomTool,
  useCustomTools,
  useDeleteCustomTool,
  useUpdateCustomTool,
} from '@/hooks/queries/custom-tools'

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
  const [isSchemaPromptActive, setIsSchemaPromptActive] = useState(false)
  const [schemaPromptInput, setSchemaPromptInput] = useState('')
  const [schemaPromptSummary, setSchemaPromptSummary] = useState<string | null>(null)
  const schemaPromptInputRef = useRef<HTMLInputElement | null>(null)

  const [isCodePromptActive, setIsCodePromptActive] = useState(false)
  const [codePromptInput, setCodePromptInput] = useState('')
  const [codePromptSummary, setCodePromptSummary] = useState<string | null>(null)
  const codePromptInputRef = useRef<HTMLInputElement | null>(null)

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
      setJsonSchema(content)
      setSchemaError(null)
    },
    onStreamChunk: (chunk) => {
      setJsonSchema((prev) => {
        const newSchema = prev + chunk
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
const userId = userId; // Correct: Accessing userId input parameter without quotes
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
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  // Add state for dropdown positioning
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
  // Schema params keyboard navigation
  const [schemaParamSelectedIndex, setSchemaParamSelectedIndex] = useState(0)

  // React Query mutations
  const createToolMutation = useCreateCustomTool()
  const updateToolMutation = useUpdateCustomTool()
  const deleteToolMutation = useDeleteCustomTool()
  const { data: customTools = [] } = useCustomTools(workspaceId)

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

  const handleSave = async () => {
    try {
      // Validation with error messages
      if (!jsonSchema) {
        setSchemaError('Schema cannot be empty')
        setActiveSection('schema')
        return
      }

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

      // No errors, proceed with save - clear any existing errors
      setSchemaError(null)
      setCodeError(null)

      // Parse schema to get tool details
      const schema = JSON.parse(jsonSchema)
      const name = schema.function.name
      const description = schema.function.description || ''

      // Determine the tool ID for editing
      let toolIdToUpdate: string | undefined = toolId
      if (isEditing && !toolIdToUpdate && initialValues?.schema) {
        const originalName = initialValues.schema.function?.name
        if (originalName) {
          const originalTool = customTools.find(
            (tool) => tool.schema?.function?.name === originalName
          )
          if (originalTool) {
            toolIdToUpdate = originalTool.id
          }
        }
      }

      // Save to the store (server validates duplicates)
      if (isEditing && toolIdToUpdate) {
        // Update existing tool
        await updateToolMutation.mutateAsync({
          workspaceId,
          toolId: toolIdToUpdate,
          updates: {
            title: name,
            schema,
            code: functionCode || '',
          },
        })
      } else {
        // Create new tool
        await createToolMutation.mutateAsync({
          workspaceId,
          tool: {
            title: name,
            schema,
            code: functionCode || '',
          },
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

      // Check if it's an API error with status code (from store)
      const hasStatus = error && typeof error === 'object' && 'status' in error
      const errorStatus = hasStatus ? (error as { status: number }).status : null
      const errorMessage = error instanceof Error ? error.message : 'Failed to save custom tool'

      // Display server validation errors (400) directly, generic message for others
      setSchemaError(
        errorStatus === 400
          ? errorMessage
          : 'Failed to save custom tool. Please check your inputs and try again.'
      )
      setActiveSection('schema')
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

  // Schema inline wand handlers (copied from regular sub-block UX)
  const handleSchemaWandClick = () => {
    if (schemaGeneration.isLoading || schemaGeneration.isStreaming) return
    setIsSchemaPromptActive(true)
    setSchemaPromptInput(schemaPromptSummary ?? '')
    setTimeout(() => {
      schemaPromptInputRef.current?.focus()
    }, 0)
  }

  const handleSchemaPromptBlur = () => {
    if (!schemaPromptInput.trim() && !schemaGeneration.isStreaming) {
      setIsSchemaPromptActive(false)
    }
  }

  const handleSchemaPromptChange = (value: string) => {
    setSchemaPromptInput(value)
  }

  const handleSchemaPromptSubmit = () => {
    const trimmedPrompt = schemaPromptInput.trim()
    if (!trimmedPrompt || schemaGeneration.isLoading || schemaGeneration.isStreaming) return
    setSchemaPromptSummary(trimmedPrompt)
    schemaGeneration.generateStream({ prompt: trimmedPrompt })
    setSchemaPromptInput('')
    setIsSchemaPromptActive(false)
  }

  const handleSchemaPromptKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSchemaPromptSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setSchemaPromptInput('')
      setIsSchemaPromptActive(false)
    }
  }

  // Code inline wand handlers
  const handleCodeWandClick = () => {
    if (codeGeneration.isLoading || codeGeneration.isStreaming) return
    setIsCodePromptActive(true)
    setCodePromptInput(codePromptSummary ?? '')
    setTimeout(() => {
      codePromptInputRef.current?.focus()
    }, 0)
  }

  const handleCodePromptBlur = () => {
    if (!codePromptInput.trim() && !codeGeneration.isStreaming) {
      setIsCodePromptActive(false)
    }
  }

  const handleCodePromptChange = (value: string) => {
    setCodePromptInput(value)
  }

  const handleCodePromptSubmit = () => {
    const trimmedPrompt = codePromptInput.trim()
    if (!trimmedPrompt || codeGeneration.isLoading || codeGeneration.isStreaming) return
    setCodePromptSummary(trimmedPrompt)
    codeGeneration.generateStream({ prompt: trimmedPrompt })
    setCodePromptInput('')
    setIsCodePromptActive(false)
  }

  const handleCodePromptKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleCodePromptSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setCodePromptInput('')
      setIsCodePromptActive(false)
    }
  }

  const handleDelete = async () => {
    if (!toolId || !isEditing) return

    try {
      setShowDeleteConfirm(false)

      // Delete using React Query mutation
      await deleteToolMutation.mutateAsync({
        workspaceId,
        toolId,
      })
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

  // Ensure modal overlay appears above Settings modal (z-index: 9999999)
  useEffect(() => {
    if (!open) return

    const styleId = 'custom-tool-modal-z-index'
    let styleEl = document.getElementById(styleId) as HTMLStyleElement

    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = styleId
      styleEl.textContent = `
        [data-radix-portal] [data-radix-dialog-overlay] {
          z-index: 10000048 !important;
        }
      `
      document.head.appendChild(styleEl)
    }

    return () => {
      const el = document.getElementById(styleId)
      if (el) {
        el.remove()
      }
    }
  }, [open])

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent
          className='flex h-[80vh] w-full max-w-[840px] flex-col gap-0 p-0'
          style={{ zIndex: 10000050 }}
          hideCloseButton
          onKeyDown={(e) => {
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
              <EmcnButton variant='ghost' onClick={handleClose}>
                <X className='h-4 w-4' />
                <span className='sr-only'>Close</span>
              </EmcnButton>
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
              <div
                className={cn(
                  'flex h-full flex-1 flex-col',
                  activeSection === 'schema' ? 'block' : 'hidden'
                )}
              >
                <div className='mb-1 flex min-h-6 items-center justify-between gap-2'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <FileJson className='h-4 w-4' />
                    <Label htmlFor='json-schema' className='font-medium'>
                      JSON Schema
                    </Label>
                    {schemaError && (
                      <div className='ml-2 flex min-w-0 items-center gap-1 text-destructive text-xs'>
                        <AlertCircle className='h-3 w-3 flex-shrink-0' />
                        <span className='truncate'>{schemaError}</span>
                      </div>
                    )}
                  </div>
                  <div className='flex min-w-0 flex-1 items-center justify-end gap-1 pr-[4px]'>
                    {!isSchemaPromptActive && schemaPromptSummary && (
                      <span className='text-muted-foreground text-xs italic'>
                        with {schemaPromptSummary}
                      </span>
                    )}
                    {!isSchemaPromptActive ? (
                      <button
                        type='button'
                        onClick={handleSchemaWandClick}
                        disabled={schemaGeneration.isLoading || schemaGeneration.isStreaming}
                        className='inline-flex h-[16px] w-[16px] items-center justify-center rounded-full hover:bg-transparent disabled:opacity-50'
                        aria-label='Generate schema with AI'
                      >
                        <Wand2 className='!h-[12px] !w-[12px] text-[var(--text-secondary)]' />
                      </button>
                    ) : (
                      <input
                        ref={schemaPromptInputRef}
                        type='text'
                        value={schemaGeneration.isStreaming ? 'Generating...' : schemaPromptInput}
                        onChange={(e) => handleSchemaPromptChange(e.target.value)}
                        onBlur={handleSchemaPromptBlur}
                        onKeyDown={handleSchemaPromptKeyDown}
                        disabled={schemaGeneration.isStreaming}
                        className='h-[16px] w-full border-none bg-transparent py-0 pr-[2px] text-right font-medium text-[12px] text-[var(--text-primary)] leading-[14px] placeholder:text-[#737373] focus:outline-none'
                        placeholder='Describe schema...'
                      />
                    )}
                  </div>
                </div>
                <div className='relative'>
                  <CodeEditor
                    value={jsonSchema}
                    onChange={handleJsonSchemaChange}
                    language='json'
                    showWandButton={false}
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
                      schemaError && 'border-red-500',
                      (schemaGeneration.isLoading || schemaGeneration.isStreaming) &&
                        'cursor-not-allowed opacity-50'
                    )}
                    disabled={schemaGeneration.isLoading || schemaGeneration.isStreaming} // Use disabled prop instead of readOnly
                    onKeyDown={handleKeyDown} // Pass keydown handler
                  />
                </div>
                <div className='h-6' />
              </div>

              <div
                className={cn(
                  'flex h-full flex-1 flex-col pb-6',
                  activeSection === 'code' ? 'block' : 'hidden'
                )}
              >
                <div className='mb-1 flex min-h-6 items-center justify-between gap-2'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <Code className='h-4 w-4' />
                    <Label htmlFor='function-code' className='font-medium'>
                      Code
                    </Label>
                  </div>
                  <div className='flex min-w-0 flex-1 items-center justify-end gap-1 pr-[4px]'>
                    {!isCodePromptActive && codePromptSummary && (
                      <span className='text-muted-foreground text-xs italic'>
                        with {codePromptSummary}
                      </span>
                    )}
                    {!isCodePromptActive ? (
                      <button
                        type='button'
                        onClick={handleCodeWandClick}
                        disabled={codeGeneration.isLoading || codeGeneration.isStreaming}
                        className='inline-flex h-[16px] w-[16px] items-center justify-center rounded-full hover:bg-transparent disabled:opacity-50'
                        aria-label='Generate code with AI'
                      >
                        <Wand2 className='!h-[12px] !w-[12px] text-[var(--text-secondary)]' />
                      </button>
                    ) : (
                      <input
                        ref={codePromptInputRef}
                        type='text'
                        value={codeGeneration.isStreaming ? 'Generating...' : codePromptInput}
                        onChange={(e) => handleCodePromptChange(e.target.value)}
                        onBlur={handleCodePromptBlur}
                        onKeyDown={handleCodePromptKeyDown}
                        disabled={codeGeneration.isStreaming}
                        className='h-[16px] w-full border-none bg-transparent py-0 pr-[2px] text-right font-medium text-[12px] text-[var(--text-primary)] leading-[14px] placeholder:text-[#737373] focus:outline-none'
                        placeholder='Describe code...'
                      />
                    )}
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
                    showWandButton={false}
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
                    <Popover
                      open={showSchemaParams}
                      onOpenChange={(open) => {
                        if (!open) {
                          setShowSchemaParams(false)
                        }
                      }}
                    >
                      <PopoverAnchor asChild>
                        <div
                          className='pointer-events-none'
                          style={{
                            position: 'absolute',
                            top: `${dropdownPosition.top}px`,
                            left: `${dropdownPosition.left}px`,
                            width: '1px',
                            height: '1px',
                          }}
                        />
                      </PopoverAnchor>
                      <PopoverContent
                        maxHeight={240}
                        className='min-w-[260px] max-w-[260px]'
                        side='bottom'
                        align='start'
                        collisionPadding={6}
                        style={{ zIndex: 100000000 }}
                        onOpenAutoFocus={(e) => e.preventDefault()}
                        onCloseAutoFocus={(e) => e.preventDefault()}
                      >
                        <PopoverScrollArea>
                          <PopoverSection>Available Parameters</PopoverSection>
                          {schemaParameters.map((param, index) => (
                            <PopoverItem
                              key={param.name}
                              rootOnly
                              active={index === schemaParamSelectedIndex}
                              onMouseEnter={() => setSchemaParamSelectedIndex(index)}
                              onMouseDown={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                handleSchemaParamSelect(param.name)
                              }}
                              className='flex items-center gap-2'
                            >
                              <div
                                className='flex h-5 w-5 items-center justify-center rounded'
                                style={{ backgroundColor: '#2F8BFF' }}
                              >
                                <span className='h-3 w-3 font-bold text-white text-xs'>P</span>
                              </div>
                              <span className='flex-1 truncate'>{param.name}</span>
                              <span className='text-muted-foreground text-xs'>{param.type}</span>
                            </PopoverItem>
                          ))}
                        </PopoverScrollArea>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
                <div className='h-6' />
              </div>
            </div>
          </div>

          <DialogFooter className='mt-auto border-t px-6 py-4'>
            <div className='flex w-full justify-between'>
              {isEditing ? (
                <EmcnButton
                  className='h-[32px] gap-1 bg-[var(--text-error)] px-[12px] text-[var(--white)] hover:bg-[var(--text-error)] hover:text-[var(--white)] dark:bg-[var(--text-error)] dark:text-[var(--white)] hover:dark:bg-[var(--text-error)] dark:hover:text-[var(--white)]'
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash className='h-4 w-4' />
                  Delete
                </EmcnButton>
              ) : (
                <EmcnButton
                  variant='outline'
                  className='h-[32px] px-[12px]'
                  onClick={() => {
                    if (activeSection === 'code') {
                      setActiveSection('schema')
                    }
                  }}
                  disabled={activeSection === 'schema'}
                >
                  Back
                </EmcnButton>
              )}
              <div className='flex space-x-2'>
                <EmcnButton variant='outline' className='h-[32px] px-[12px]' onClick={handleClose}>
                  Cancel
                </EmcnButton>
                {activeSection === 'schema' ? (
                  <EmcnButton
                    variant='primary'
                    className='h-[32px] px-[12px]'
                    onClick={() => setActiveSection('code')}
                    disabled={!isSchemaValid || !!schemaError}
                  >
                    Next
                  </EmcnButton>
                ) : (
                  <EmcnButton
                    variant='primary'
                    className='h-[32px] px-[12px]'
                    onClick={handleSave}
                    disabled={!isSchemaValid || !!schemaError}
                  >
                    {isEditing ? 'Update Tool' : 'Save Tool'}
                  </EmcnButton>
                )}
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Modal open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Delete custom tool?</ModalTitle>
            <ModalDescription>
              This will permanently delete the tool and remove it from any workflows that are using
              it.{' '}
              <span className='text-[var(--text-error)] dark:text-[var(--text-error)]'>
                This action cannot be undone.
              </span>
            </ModalDescription>
          </ModalHeader>
          <ModalFooter>
            <Button
              variant='outline'
              className='h-[32px] px-[12px]'
              onClick={() => setShowDeleteConfirm(false)}
              disabled={deleteToolMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleteToolMutation.isPending}
              className='h-[32px] bg-[var(--text-error)] px-[12px] text-[var(--white)] hover:bg-[var(--text-error)] hover:text-[var(--white)] dark:bg-[var(--text-error)] dark:text-[var(--white)] hover:dark:bg-[var(--text-error)] dark:hover:text-[var(--white)]'
            >
              {deleteToolMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
