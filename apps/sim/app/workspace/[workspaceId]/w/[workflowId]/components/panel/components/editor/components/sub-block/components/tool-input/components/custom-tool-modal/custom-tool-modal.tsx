import { useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { AlertCircle, ArrowUp } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTabs,
  ModalTabsContent,
  ModalTabsList,
  ModalTabsTrigger,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverSection,
} from '@/components/emcn'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/core/utils/cn'
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
  id?: string
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
  const [initialJsonSchema, setInitialJsonSchema] = useState('')
  const [initialFunctionCode, setInitialFunctionCode] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showDiscardAlert, setShowDiscardAlert] = useState(false)
  const [isSchemaPromptActive, setIsSchemaPromptActive] = useState(false)
  const [schemaPromptInput, setSchemaPromptInput] = useState('')
  const schemaPromptInputRef = useRef<HTMLInputElement | null>(null)

  const [isCodePromptActive, setIsCodePromptActive] = useState(false)
  const [codePromptInput, setCodePromptInput] = useState('')
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
    onStreamStart: () => {
      setJsonSchema('')
    },
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
- 'params' (object): Contains input parameters derived from the JSON schema. Reference these directly by name (e.g., 'userId', 'cityName'). Do NOT use 'params.paramName'.
- 'environmentVariables' (object): Contains environment variables. Reference these using the double curly brace syntax: '{{ENV_VAR_NAME}}'. Do NOT use 'environmentVariables.VAR_NAME' or env.

Current code: {context}

IMPORTANT FORMATTING RULES:
1. Reference Environment Variables: Use the exact syntax {{VARIABLE_NAME}}. Do NOT wrap it in quotes (e.g., use 'const apiKey = {{SERVICE_API_KEY}};' not 'const apiKey = "{{SERVICE_API_KEY}}";'). Our system replaces these placeholders before execution.
2. Reference Input Parameters/Workflow Variables: Reference them directly by name (e.g., 'const city = cityName;' or use directly in template strings like \`\${cityName}\`). Do NOT wrap in quotes or angle brackets.
3. Function Body ONLY: Do NOT include the function signature (e.g., 'async function myFunction() {' or the surrounding '}').
4. Imports: Do NOT include import/require statements unless they are standard Node.js built-in modules (e.g., 'crypto', 'fs'). External libraries are not supported in this context.
5. Output: Ensure the code returns a value if the function is expected to produce output. Use 'return'.
6. Clarity: Write clean, readable code.
7. No Explanations: Do NOT include markdown formatting, comments explaining the rules, or any text other than the raw JavaScript code for the function body.

Example Scenario:
User Prompt: "Fetch weather data from OpenWeather API. Use the city name passed in as 'cityName' and an API Key stored as the 'OPENWEATHER_API_KEY' environment variable."

Generated Code:
const apiKey = {{OPENWEATHER_API_KEY}};
const url = \`https://api.openweathermap.org/data/2.5/weather?q=\${cityName}&appid=\${apiKey}\`;

try {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(\`API request failed with status \${response.status}: \${await response.text()}\`);
  }

  const weatherData = await response.json();
  return weatherData;
} catch (error) {
  console.error(\`Error fetching weather data: \${error.message}\`);
  throw error;
}`,
      placeholder: 'Describe the JavaScript function to generate...',
      generationType: 'javascript-function-body',
    },
    currentValue: functionCode,
    onStreamStart: () => {
      setFunctionCode('')
    },
    onGeneratedContent: (content) => {
      handleFunctionCodeChange(content)
      setCodeError(null)
    },
    onStreamChunk: (chunk) => {
      setFunctionCode((prev) => {
        const newCode = prev + chunk
        handleFunctionCodeChange(newCode)
        if (codeError) setCodeError(null)
        return newCode
      })
    },
  })

  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [showSchemaParams, setShowSchemaParams] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const codeEditorRef = useRef<HTMLDivElement>(null)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
  const [schemaParamSelectedIndex, setSchemaParamSelectedIndex] = useState(0)
  const schemaParamItemRefs = useRef<Map<number, HTMLElement>>(new Map())

  const createToolMutation = useCreateCustomTool()
  const updateToolMutation = useUpdateCustomTool()
  const deleteToolMutation = useDeleteCustomTool()
  const { data: customTools = [] } = useCustomTools(workspaceId)

  useEffect(() => {
    if (!open) return

    if (initialValues) {
      try {
        const schemaValue =
          typeof initialValues.schema === 'string'
            ? initialValues.schema
            : JSON.stringify(initialValues.schema, null, 2)
        const codeValue = initialValues.code || ''
        setJsonSchema(schemaValue)
        setFunctionCode(codeValue)
        setInitialJsonSchema(schemaValue)
        setInitialFunctionCode(codeValue)
        setIsEditing(true)
        setToolId(initialValues.id)
      } catch (error) {
        logger.error('Error initializing form with initial values:', { error })
        setSchemaError('Failed to load tool data. Please try again.')
      }
    } else {
      resetForm()
    }
  }, [open])

  useEffect(() => {
    if (!showSchemaParams || schemaParamSelectedIndex < 0) return

    const element = schemaParamItemRefs.current.get(schemaParamSelectedIndex)
    if (element) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [schemaParamSelectedIndex, showSchemaParams])

  const resetForm = () => {
    setJsonSchema('')
    setFunctionCode('')
    setInitialJsonSchema('')
    setInitialFunctionCode('')
    setSchemaError(null)
    setCodeError(null)
    setActiveSection('schema')
    setIsEditing(false)
    setToolId(undefined)
    setIsSchemaPromptActive(false)
    setIsCodePromptActive(false)
    setSchemaPromptInput('')
    setCodePromptInput('')
    setShowDiscardAlert(false)
    schemaGeneration.closePrompt()
    schemaGeneration.hidePromptInline()
    codeGeneration.closePrompt()
    codeGeneration.hidePromptInline()
  }

  const handleClose = () => {
    if (schemaGeneration.isStreaming) schemaGeneration.cancelGeneration()
    if (codeGeneration.isStreaming) codeGeneration.cancelGeneration()
    resetForm()
    onOpenChange(false)
  }

  const validateSchema = (schema: string): { isValid: boolean; error: string | null } => {
    if (!schema) return { isValid: false, error: null }

    try {
      const parsed = JSON.parse(schema)

      if (!parsed.type || parsed.type !== 'function') {
        return { isValid: false, error: 'Missing "type": "function"' }
      }
      if (!parsed.function || !parsed.function.name) {
        return { isValid: false, error: 'Missing function.name field' }
      }
      if (!parsed.function.parameters) {
        return { isValid: false, error: 'Missing function.parameters object' }
      }
      if (!parsed.function.parameters.type) {
        return { isValid: false, error: 'Missing parameters.type field' }
      }
      if (parsed.function.parameters.properties === undefined) {
        return { isValid: false, error: 'Missing parameters.properties field' }
      }
      if (
        typeof parsed.function.parameters.properties !== 'object' ||
        parsed.function.parameters.properties === null
      ) {
        return { isValid: false, error: 'parameters.properties must be an object' }
      }

      return { isValid: true, error: null }
    } catch {
      return { isValid: false, error: 'Invalid JSON format' }
    }
  }

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

  const isSchemaValid = useMemo(() => validateSchema(jsonSchema).isValid, [jsonSchema])

  const hasChanges = useMemo(() => {
    if (!isEditing) return true
    return jsonSchema !== initialJsonSchema || functionCode !== initialFunctionCode
  }, [isEditing, jsonSchema, initialJsonSchema, functionCode, initialFunctionCode])

  const hasUnsavedChanges = useMemo(() => {
    if (isEditing) {
      return jsonSchema !== initialJsonSchema || functionCode !== initialFunctionCode
    }
    return jsonSchema.trim().length > 0 || functionCode.trim().length > 0
  }, [isEditing, jsonSchema, initialJsonSchema, functionCode, initialFunctionCode])

  const handleCloseAttempt = () => {
    if (hasUnsavedChanges && !schemaGeneration.isStreaming && !codeGeneration.isStreaming) {
      setShowDiscardAlert(true)
    } else {
      handleClose()
    }
  }

  const handleConfirmDiscard = () => {
    setShowDiscardAlert(false)
    handleClose()
  }

  const handleSave = async () => {
    try {
      if (!jsonSchema) {
        setSchemaError('Schema cannot be empty')
        setActiveSection('schema')
        return
      }

      const { isValid, error } = validateSchema(jsonSchema)
      if (!isValid) {
        setSchemaError(error)
        setActiveSection('schema')
        return
      }

      setSchemaError(null)
      setCodeError(null)

      const schema = JSON.parse(jsonSchema)
      const name = schema.function.name
      const description = schema.function.description || ''

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

      let savedToolId: string | undefined

      if (isEditing && toolIdToUpdate) {
        await updateToolMutation.mutateAsync({
          workspaceId,
          toolId: toolIdToUpdate,
          updates: {
            title: name,
            schema,
            code: functionCode || '',
          },
        })
        savedToolId = toolIdToUpdate
      } else {
        const result = await createToolMutation.mutateAsync({
          workspaceId,
          tool: {
            title: name,
            schema,
            code: functionCode || '',
          },
        })
        savedToolId = result?.[0]?.id
      }

      const customTool: CustomTool = {
        type: 'custom-tool',
        id: savedToolId,
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
      const errorMessage = error instanceof Error ? error.message : 'Failed to save custom tool'

      if (errorMessage.includes('Cannot change function name')) {
        setSchemaError(
          'Function name cannot be changed after creation. To use a different name, delete this tool and create a new one.'
        )
      } else {
        setSchemaError(errorMessage)
      }
      setActiveSection('schema')
    }
  }

  const handleJsonSchemaChange = (value: string) => {
    if (schemaGeneration.isLoading || schemaGeneration.isStreaming) return
    setJsonSchema(value)

    if (value.trim()) {
      const { error } = validateSchema(value)
      setSchemaError(error)
    } else {
      setSchemaError(null)
    }
  }

  const handleFunctionCodeChange = (value: string) => {
    if (codeGeneration.isLoading || codeGeneration.isStreaming) {
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

    const textarea = codeEditorRef.current?.querySelector('textarea')
    if (textarea) {
      const pos = textarea.selectionStart
      setCursorPosition(pos)

      const textBeforeCursor = value.substring(0, pos)
      const lines = textBeforeCursor.split('\n')
      const currentLine = lines.length
      const currentCol = lines[lines.length - 1].length

      try {
        if (codeEditorRef.current) {
          const editorRect = codeEditorRef.current.getBoundingClientRect()
          const lineHeight = 21

          const top = currentLine * lineHeight + 5
          const left = Math.min(currentCol * 8, editorRect.width - 260)

          setDropdownPosition({ top, left })
        }
      } catch (error) {
        logger.error('Error calculating cursor position:', { error })
      }

      const envVarTrigger = checkEnvVarTrigger(value, pos)
      setShowEnvVars(envVarTrigger.show && !codeGeneration.isStreaming)
      setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')

      const tagTrigger = checkTagTrigger(value, pos)
      setShowTags(tagTrigger.show && !codeGeneration.isStreaming)
      if (!tagTrigger.show) {
        setActiveSourceBlockId(null)
      }

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

  const checkSchemaParamTrigger = (text: string, cursorPos: number, parameters: any[]) => {
    if (parameters.length === 0) return { show: false, searchTerm: '' }

    const beforeCursor = text.substring(0, cursorPos)
    const words = beforeCursor.split(/[\s=();,{}[\]]+/)
    const currentWord = words[words.length - 1] || ''

    if (currentWord.length > 0 && /^[a-zA-Z_][\w]*$/.test(currentWord)) {
      const matchingParams = parameters.filter((param) =>
        param.name.toLowerCase().startsWith(currentWord.toLowerCase())
      )
      return { show: matchingParams.length > 0, searchTerm: currentWord, matches: matchingParams }
    }

    return { show: false, searchTerm: '' }
  }

  const handleEnvVarSelect = (newValue: string) => {
    setFunctionCode(newValue)
    setShowEnvVars(false)
  }

  const handleTagSelect = (newValue: string) => {
    setFunctionCode(newValue)
    setShowTags(false)
    setActiveSourceBlockId(null)
  }

  const handleSchemaParamSelect = (paramName: string) => {
    const textarea = codeEditorRef.current?.querySelector('textarea')
    if (textarea) {
      const pos = textarea.selectionStart
      const beforeCursor = functionCode.substring(0, pos)
      const afterCursor = functionCode.substring(pos)

      const words = beforeCursor.split(/[\s=();,{}[\]]+/)
      const currentWord = words[words.length - 1] || ''
      const wordStart = beforeCursor.lastIndexOf(currentWord)

      const newValue = beforeCursor.substring(0, wordStart) + paramName + afterCursor
      setFunctionCode(newValue)
      setShowSchemaParams(false)

      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(wordStart + paramName.length, wordStart + paramName.length)
      }, 0)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
      if (showEnvVars || showTags || showSchemaParams) {
        setShowEnvVars(false)
        setShowTags(false)
        setShowSchemaParams(false)
        e.preventDefault()
        e.stopPropagation()
        return
      }
    }

    if (activeSection === 'schema' && schemaGeneration.isStreaming) {
      e.preventDefault()
      return
    }
    if (activeSection === 'code' && codeGeneration.isStreaming) {
      e.preventDefault()
      return
    }

    if (showSchemaParams && schemaParameters.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          setSchemaParamSelectedIndex((prev) => Math.min(prev + 1, schemaParameters.length - 1))
          return
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          setSchemaParamSelectedIndex((prev) => Math.max(prev - 1, 0))
          return
        case 'Enter':
          e.preventDefault()
          e.stopPropagation()
          if (schemaParamSelectedIndex >= 0 && schemaParamSelectedIndex < schemaParameters.length) {
            const selectedParam = schemaParameters[schemaParamSelectedIndex]
            handleSchemaParamSelect(selectedParam.name)
          }
          return
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          setShowSchemaParams(false)
          return
        case ' ':
        case 'Tab':
          setShowSchemaParams(false)
          return
      }
    }

    if (showEnvVars || showTags) {
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
  }

  const handleSchemaWandClick = () => {
    if (schemaGeneration.isLoading || schemaGeneration.isStreaming) return
    setIsSchemaPromptActive(true)
    setSchemaPromptInput('')
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

  const handleCodeWandClick = () => {
    if (codeGeneration.isLoading || codeGeneration.isStreaming) return
    setIsCodePromptActive(true)
    setCodePromptInput('')
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

      await deleteToolMutation.mutateAsync({
        workspaceId,
        toolId,
      })
      logger.info(`Deleted tool: ${toolId}`)

      if (onDelete) {
        onDelete(toolId)
      }

      handleClose()
    } catch (error) {
      logger.error('Error deleting custom tool:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete custom tool'
      setSchemaError(`${errorMessage}. Please try again.`)
      setActiveSection('schema')
      setShowDeleteConfirm(false)
    }
  }

  return (
    <>
      <Modal open={open} onOpenChange={handleCloseAttempt}>
        <ModalContent size='xl'>
          <ModalHeader>{isEditing ? 'Edit Agent Tool' : 'Create Agent Tool'}</ModalHeader>

          <ModalTabs
            value={activeSection}
            onValueChange={(value) => setActiveSection(value as ToolSection)}
            className='flex min-h-0 flex-1 flex-col'
          >
            <ModalTabsList activeValue={activeSection}>
              <ModalTabsTrigger value='schema'>Schema</ModalTabsTrigger>
              <ModalTabsTrigger value='code'>Code</ModalTabsTrigger>
            </ModalTabsList>

            <ModalBody className='min-h-0 flex-1'>
              <ModalTabsContent value='schema'>
                <div className='mb-1 flex min-h-6 items-center justify-between gap-2'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <Label htmlFor='json-schema' className='font-medium text-[13px]'>
                      JSON Schema
                    </Label>
                    {schemaError && (
                      <div className='ml-2 flex min-w-0 items-center gap-1 text-[12px] text-[var(--text-error)]'>
                        <AlertCircle className='h-3 w-3 flex-shrink-0' />
                        <span className='truncate'>{schemaError}</span>
                      </div>
                    )}
                  </div>
                  <div className='flex min-w-0 items-center justify-end gap-[4px]'>
                    {!isSchemaPromptActive ? (
                      <Button
                        variant='active'
                        className='-my-1 h-5 px-2 py-0 text-[11px]'
                        onClick={handleSchemaWandClick}
                        disabled={schemaGeneration.isLoading || schemaGeneration.isStreaming}
                      >
                        Generate
                      </Button>
                    ) : (
                      <div className='-my-1 flex items-center gap-[4px]'>
                        <Input
                          ref={schemaPromptInputRef}
                          value={schemaGeneration.isStreaming ? 'Generating...' : schemaPromptInput}
                          onChange={(e) => handleSchemaPromptChange(e.target.value)}
                          onBlur={handleSchemaPromptBlur}
                          onKeyDown={handleSchemaPromptKeyDown}
                          disabled={schemaGeneration.isStreaming}
                          className={cn(
                            'h-5 max-w-[200px] flex-1 text-[11px]',
                            schemaGeneration.isStreaming && 'text-muted-foreground'
                          )}
                          placeholder='Generate...'
                        />
                        <Button
                          variant='tertiary'
                          disabled={!schemaPromptInput.trim() || schemaGeneration.isStreaming}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSchemaPromptSubmit()
                          }}
                          className='h-[20px] w-[20px] flex-shrink-0 p-0'
                        >
                          <ArrowUp className='h-[12px] w-[12px]' />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
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
                  minHeight='420px'
                  className={cn(
                    'bg-[var(--bg)]',
                    schemaError && 'border-[var(--text-error)]',
                    (schemaGeneration.isLoading || schemaGeneration.isStreaming) &&
                      'cursor-not-allowed opacity-50'
                  )}
                  gutterClassName='bg-[var(--bg)]'
                  disabled={schemaGeneration.isLoading || schemaGeneration.isStreaming}
                  onKeyDown={handleKeyDown}
                />
              </ModalTabsContent>

              <ModalTabsContent value='code'>
                <div className='mb-1 flex min-h-6 items-center justify-between gap-2'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <Label htmlFor='function-code' className='font-medium text-[13px]'>
                      Code
                    </Label>
                    {codeError && !codeGeneration.isStreaming && (
                      <div className='ml-2 flex min-w-0 items-center gap-1 text-[12px] text-[var(--text-error)]'>
                        <AlertCircle className='h-3 w-3 flex-shrink-0' />
                        <span className='truncate'>{codeError}</span>
                      </div>
                    )}
                  </div>
                  <div className='flex min-w-0 items-center justify-end gap-[4px]'>
                    {!isCodePromptActive ? (
                      <Button
                        variant='active'
                        className='-my-1 h-5 px-2 py-0 text-[11px]'
                        onClick={handleCodeWandClick}
                        disabled={codeGeneration.isLoading || codeGeneration.isStreaming}
                      >
                        Generate
                      </Button>
                    ) : (
                      <div className='-my-1 flex items-center gap-[4px]'>
                        <Input
                          ref={codePromptInputRef}
                          value={codeGeneration.isStreaming ? 'Generating...' : codePromptInput}
                          onChange={(e) => handleCodePromptChange(e.target.value)}
                          onBlur={handleCodePromptBlur}
                          onKeyDown={handleCodePromptKeyDown}
                          disabled={codeGeneration.isStreaming}
                          className={cn(
                            'h-5 max-w-[200px] flex-1 text-[11px]',
                            codeGeneration.isStreaming && 'text-muted-foreground'
                          )}
                          placeholder='Generate...'
                        />
                        <Button
                          variant='tertiary'
                          disabled={!codePromptInput.trim() || codeGeneration.isStreaming}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCodePromptSubmit()
                          }}
                          className='h-[20px] w-[20px] flex-shrink-0 p-0'
                        >
                          <ArrowUp className='h-[12px] w-[12px]' />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                {schemaParameters.length > 0 && (
                  <div className='mb-2 rounded-[6px] border bg-[var(--surface-2)] p-2'>
                    <div className='flex flex-wrap items-center gap-1.5 text-xs'>
                      <span className='font-medium text-[var(--text-tertiary)]'>
                        Available parameters:
                      </span>
                      {schemaParameters.map((param) => (
                        <Badge key={param.name} variant='blue-secondary' size='sm'>
                          {param.name}
                        </Badge>
                      ))}
                      <span className='text-[var(--text-tertiary)]'>
                        Start typing a parameter name for autocomplete.
                      </span>
                    </div>
                  </div>
                )}
                <div ref={codeEditorRef} className='relative'>
                  <CodeEditor
                    value={functionCode}
                    onChange={handleFunctionCodeChange}
                    language='javascript'
                    showWandButton={false}
                    placeholder={'return schemaVariable + {{environmentVariable}}'}
                    minHeight={schemaParameters.length > 0 ? '380px' : '420px'}
                    className={cn(
                      'bg-[var(--bg)]',
                      codeError && !codeGeneration.isStreaming && 'border-[var(--text-error)]',
                      (codeGeneration.isLoading || codeGeneration.isStreaming) &&
                        'cursor-not-allowed opacity-50'
                    )}
                    gutterClassName='bg-[var(--bg)]'
                    highlightVariables={true}
                    disabled={codeGeneration.isLoading || codeGeneration.isStreaming}
                    onKeyDown={handleKeyDown}
                    schemaParameters={schemaParameters}
                  />

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
                        className='min-w-[280px]'
                        side='bottom'
                        align='start'
                        collisionPadding={6}
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
                              ref={(el) => {
                                if (el) {
                                  schemaParamItemRefs.current.set(index, el)
                                }
                              }}
                            >
                              <span className='flex-1 truncate text-[var(--text-primary)]'>
                                {param.name}
                              </span>
                              {param.type && param.type !== 'any' && (
                                <span className='ml-auto text-[10px] text-[var(--text-secondary)]'>
                                  {param.type}
                                </span>
                              )}
                            </PopoverItem>
                          ))}
                        </PopoverScrollArea>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </ModalTabsContent>
            </ModalBody>
          </ModalTabs>

          {activeSection === 'schema' && (
            <ModalFooter className='items-center justify-between'>
              {isEditing ? (
                <Button variant='destructive' onClick={() => setShowDeleteConfirm(true)}>
                  Delete
                </Button>
              ) : (
                <div />
              )}
              <div className='flex gap-2'>
                <Button variant='default' onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  variant='tertiary'
                  onClick={() => setActiveSection('code')}
                  disabled={!isSchemaValid || !!schemaError}
                >
                  Next
                </Button>
              </div>
            </ModalFooter>
          )}

          {activeSection === 'code' && (
            <ModalFooter className='items-center justify-between'>
              {isEditing ? (
                <Button variant='destructive' onClick={() => setShowDeleteConfirm(true)}>
                  Delete
                </Button>
              ) : (
                <Button variant='default' onClick={() => setActiveSection('schema')}>
                  Back
                </Button>
              )}
              <div className='flex gap-2'>
                <Button variant='default' onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  variant='tertiary'
                  onClick={handleSave}
                  disabled={!isSchemaValid || !!schemaError || !hasChanges}
                >
                  {isEditing ? 'Update Tool' : 'Save Tool'}
                </Button>
              </div>
            </ModalFooter>
          )}
        </ModalContent>
      </Modal>

      <Modal open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Custom Tool</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              This will permanently delete the tool and remove it from any workflows that are using
              it. <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => setShowDeleteConfirm(false)}
              disabled={deleteToolMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleDelete}
              disabled={deleteToolMutation.isPending}
            >
              {deleteToolMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={showDiscardAlert} onOpenChange={setShowDiscardAlert}>
        <ModalContent size='sm'>
          <ModalHeader>Unsaved Changes</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              You have unsaved changes to this tool. Are you sure you want to discard your changes
              and close the editor?
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowDiscardAlert(false)}>
              Keep Editing
            </Button>
            <Button variant='destructive' onClick={handleConfirmDiscard}>
              Discard Changes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
