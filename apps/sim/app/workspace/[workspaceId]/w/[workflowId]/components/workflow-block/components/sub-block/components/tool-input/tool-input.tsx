import { useCallback, useState } from 'react'
import { PlusIcon, WrenchIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { OAuthProvider } from '@/lib/oauth/oauth'
import { cn } from '@/lib/utils'
import { getAllBlocks } from '@/blocks'
import { getProviderFromModel, supportsToolUsageControl } from '@/providers/utils'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { getTool } from '@/tools/utils'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'
import { ChannelSelectorInput } from '../channel-selector/channel-selector-input'
import { CredentialSelector } from '../credential-selector/credential-selector'
import { ShortInput } from '../short-input'
import { type CustomTool, CustomToolModal } from './components/custom-tool-modal/custom-tool-modal'
import { ToolCommand } from './components/tool-command/tool-command'

interface ToolInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: any
  disabled?: boolean
}

interface StoredTool {
  type: string
  title: string
  params: Record<string, string>
  isExpanded?: boolean
  schema?: any // For custom tools
  code?: string // For custom tools implementation
  operation?: string // For tools with multiple operations
  usageControl?: 'auto' | 'force' | 'none' // Control how the tool is used
}

interface ToolParam {
  id: string
  type: string
  description?: string
  requiredForToolCall: boolean
  optionalToolInput?: boolean
}

// Assumes the first tool in the access array is the tool to be used
// TODO: Switch to getting tools instead of tool blocks once we switch to providers
const getToolIdFromBlock = (blockType: string): string | undefined => {
  const block = getAllBlocks().find((block) => block.type === blockType)
  return block?.tools.access[0]
}

// Get parameters that need to be displayed in the tool input UI
const getToolDisplayParams = (toolId: string): ToolParam[] => {
  const tool = getTool(toolId)
  if (!tool) return []

  return Object.entries(tool.params)
    .filter(([_, param]) => param.requiredForToolCall || param.optionalToolInput)
    .map(([paramId, param]) => ({
      id: paramId,
      type: param.type,
      description: param.description,
      requiredForToolCall: param.requiredForToolCall ?? false,
      optionalToolInput: param.optionalToolInput ?? false,
    }))
}

// Get filtered parameters based on block conditions
const getFilteredToolParams = (
  blockType: string,
  toolId: string,
  currentOperation?: string,
  toolParams?: Record<string, string>
): ToolParam[] => {
  const tool = getTool(toolId)
  const block = getAllBlocks().find((block) => block.type === blockType)

  if (!tool || !block) return []

  const allParams = Object.entries(tool.params)
    .filter(([_, param]) => param.requiredForToolCall || param.optionalToolInput)
    .map(([paramId, param]) => ({
      id: paramId,
      type: param.type,
      description: param.description,
      requiredForToolCall: param.requiredForToolCall ?? false,
      optionalToolInput: param.optionalToolInput ?? false,
    }))

  const evaluateCondition = (condition: any, currentValues: Record<string, any>): boolean => {
    const fieldValue = currentValues[condition.field]
    let result = false

    if (Array.isArray(condition.value)) {
      result = condition.value.includes(fieldValue)
    } else {
      result = fieldValue === condition.value
    }

    if (condition.not) {
      result = !result
    }

    return result
  }

  return allParams.filter((param) => {
    const subBlock = block.subBlocks.find((sb) => sb.id === param.id)

    if (!subBlock || !subBlock.condition) {
      return true
    }

    const currentValues: Record<string, any> = {
      operation: currentOperation,
      ...toolParams,
    }

    const condition = subBlock.condition
    let mainConditionResult = evaluateCondition(condition, currentValues)

    if (condition.and) {
      const andConditionResult = evaluateCondition(condition.and, currentValues)
      mainConditionResult = mainConditionResult && andConditionResult
    }

    return mainConditionResult
  })
}

// Keep this for backward compatibility - only get strictly required parameters
const getRequiredToolParams = (toolId: string): ToolParam[] => {
  const tool = getTool(toolId)
  if (!tool) return []

  return Object.entries(tool.params)
    .filter(([_, param]) => param.requiredForToolCall || param.optionalToolInput)
    .map(([paramId, param]) => ({
      id: paramId,
      type: param.type,
      description: param.description,
      requiredForToolCall: param.requiredForToolCall ?? false,
      optionalToolInput: param.optionalToolInput ?? false,
    }))
}

// Check if a tool requires OAuth
const getOAuthConfig = (toolId: string) => {
  const tool = getTool(toolId)
  return tool?.oauth
}

// For custom tools, extract parameters from the schema
const getCustomToolParams = (schema: any): ToolParam[] => {
  if (!schema?.function?.parameters?.properties) return []

  const properties = schema.function.parameters.properties
  const required = schema.function.parameters.required || []
  const optionalInputs = schema.function.parameters.optionalToolInputs || []

  return Object.entries(properties).map(([paramId, param]: [string, any]) => ({
    id: paramId,
    type: param.type || 'string',
    description: param.description || '',
    requiredForToolCall: required.includes(paramId),
    optionalToolInput: optionalInputs.includes(paramId),
  }))
}

// Check if a block has multiple operations
const hasMultipleOperations = (blockType: string): boolean => {
  const block = getAllBlocks().find((block) => block.type === blockType)
  return (block?.tools?.access?.length || 0) > 1
}

// Get operation options for a block
const getOperationOptions = (blockType: string): { label: string; id: string }[] => {
  const block = getAllBlocks().find((block) => block.type === blockType)
  if (!block || !block.tools?.access) return []

  // Look for an operation dropdown in the block's subBlocks
  const operationSubBlock = block.subBlocks.find((sb) => sb.id === 'operation')
  if (
    operationSubBlock &&
    operationSubBlock.type === 'dropdown' &&
    Array.isArray(operationSubBlock.options)
  ) {
    return operationSubBlock.options as { label: string; id: string }[]
  }

  // Fallback: create options from tools.access
  return block.tools.access.map((toolId) => {
    const tool = getTool(toolId)
    return {
      id: toolId,
      label: tool?.name || toolId,
    }
  })
}

// Helper function to initialize tool parameters
const initializeToolParams = (
  toolId: string,
  params: ToolParam[],
  subBlockStore: {
    resolveToolParamValue: (
      toolId: string,
      paramId: string,
      instanceId?: string
    ) => string | undefined
  },
  isAutoFillEnabled: boolean,
  instanceId?: string
): Record<string, string> => {
  const initialParams: Record<string, string> = {}

  // Only auto-fill parameters if the setting is enabled
  if (isAutoFillEnabled) {
    // For each parameter, check if we have a stored/resolved value
    params.forEach((param) => {
      const resolvedValue = subBlockStore.resolveToolParamValue(toolId, param.id, instanceId)
      if (resolvedValue) {
        initialParams[param.id] = resolvedValue
      }
    })
  }

  return initialParams
}

// Helper function to check if a tool has expandable content
const hasExpandableContent = (
  isCustomTool: boolean,
  hasOperations: boolean,
  operationOptions: { label: string; id: string }[],
  toolId: string | null | undefined,
  requiredParams: ToolParam[]
): boolean => {
  // Custom tools are always expandable and handle their own content
  if (isCustomTool) return true

  // Check if it has operations
  if (hasOperations && operationOptions.length > 0) return true

  // Check if it has OAuth requirements
  if (toolId) {
    const oauthConfig = getOAuthConfig(toolId)
    if (oauthConfig?.required) return true
  }

  // Check if it has required parameters
  if (requiredParams.length > 0) return true

  // No expandable content
  return false
}

// Helper to format parameter IDs into human-readable labels
const formatParamId = (paramId: string): string => {
  // Special case for common parameter names
  if (paramId === 'apiKey') return 'API Key'
  if (paramId === 'apiVersion') return 'API Version'

  // Handle underscore and hyphen separated words
  if (paramId.includes('_') || paramId.includes('-')) {
    return paramId
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  // Handle single character parameters
  if (paramId.length === 1) return paramId.toUpperCase()

  // Handle camelCase
  if (/[A-Z]/.test(paramId)) {
    const result = paramId.replace(/([A-Z])/g, ' $1')
    return (
      result.charAt(0).toUpperCase() +
      result
        .slice(1)
        .replace(/ Api/g, ' API')
        .replace(/ Id/g, ' ID')
        .replace(/ Url/g, ' URL')
        .replace(/ Uri/g, ' URI')
        .replace(/ Ui/g, ' UI')
    )
  }

  // Simple case - just capitalize first letter
  return paramId.charAt(0).toUpperCase() + paramId.slice(1)
}

// Helper function to check if a parameter should use a channel selector
const shouldUseChannelSelector = (blockType: string, paramId: string): boolean => {
  const block = getAllBlocks().find((block) => block.type === blockType)
  if (!block) return false

  // Look for a subBlock with the same ID that has type 'channel-selector'
  const subBlock = block.subBlocks.find((sb) => sb.id === paramId)
  return subBlock?.type === 'channel-selector'
}

// Helper function to get channel selector configuration from block definition
const getChannelSelectorConfig = (blockType: string, paramId: string) => {
  const block = getAllBlocks().find((block) => block.type === blockType)
  if (!block) return null

  const subBlock = block.subBlocks.find((sb) => sb.id === paramId && sb.type === 'channel-selector')
  return subBlock || null
}

// Helper function to check if a parameter should be treated as a password field
const shouldBePasswordField = (blockType: string, paramId: string): boolean => {
  const block = getAllBlocks().find((block) => block.type === blockType)
  if (block) {
    const subBlock = block.subBlocks.find((sb) => sb.id === paramId)
    if (subBlock?.password) {
      return true
    }
  }

  return false
}

export function ToolInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
}: ToolInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)
  const [open, setOpen] = useState(false)
  const [customToolModalOpen, setCustomToolModalOpen] = useState(false)
  const [editingToolIndex, setEditingToolIndex] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const isWide = useWorkflowStore((state) => state.blocks[blockId]?.isWide)
  const customTools = useCustomToolsStore((state) => state.getAllTools())
  const subBlockStore = useSubBlockStore()
  const isAutoFillEnvVarsEnabled = useGeneralStore((state) => state.isAutoFillEnvVarsEnabled)

  // Get the current model from the 'model' subblock
  const modelValue = useSubBlockStore.getState().getValue(blockId, 'model')
  const model = typeof modelValue === 'string' ? modelValue : ''
  const provider = model ? getProviderFromModel(model) : ''
  const supportsToolControl = provider ? supportsToolUsageControl(provider) : false

  const toolBlocks = getAllBlocks().filter((block) => block.category === 'tools')

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  // Custom filter function for the Command component
  const customFilter = useCallback((value: string, search: string) => {
    if (!search.trim()) return 1

    const normalizedValue = value.toLowerCase()
    const normalizedSearch = search.toLowerCase()

    // Exact match gets highest priority
    if (normalizedValue === normalizedSearch) return 1

    // Starts with search term gets high priority
    if (normalizedValue.startsWith(normalizedSearch)) return 0.8

    // Contains search term gets medium priority
    if (normalizedValue.includes(normalizedSearch)) return 0.6

    // No match
    return 0
  }, [])

  const selectedTools: StoredTool[] =
    Array.isArray(value) && value.length > 0 && typeof value[0] === 'object'
      ? (value as unknown as StoredTool[])
      : []

  // Check if a tool is already selected
  const isToolAlreadySelected = (toolType: string) => {
    return selectedTools.some((tool) => tool.type === toolType)
  }

  const handleSelectTool = (toolBlock: (typeof toolBlocks)[0]) => {
    if (isPreview || disabled) return

    const hasOperations = hasMultipleOperations(toolBlock.type)
    const operationOptions = hasOperations ? getOperationOptions(toolBlock.type) : []
    const defaultOperation = operationOptions.length > 0 ? operationOptions[0].id : undefined

    const toolId = getToolIdFromBlock(toolBlock.type) || toolBlock.type
    const displayParams = toolId
      ? getFilteredToolParams(toolBlock.type, toolId, defaultOperation, {})
      : []

    // Use the helper function to initialize parameters with blockId as instanceId
    const initialParams = initializeToolParams(
      toolId,
      displayParams,
      subBlockStore,
      isAutoFillEnvVarsEnabled,
      blockId
    )

    const newTool: StoredTool = {
      type: toolBlock.type,
      title: toolBlock.name,
      params: initialParams,
      isExpanded: true,
      operation: defaultOperation,
      usageControl: 'auto',
    }

    // If isWide, keep tools in the same row expanded
    if (isWide) {
      setStoreValue([
        ...selectedTools.map((tool, index) => ({
          ...tool,
          // Keep expanded if it's in the same row as the new tool
          isExpanded: Math.floor(selectedTools.length / 2) === Math.floor(index / 2),
        })),
        newTool,
      ])
    } else {
      // Original behavior for non-wide mode
      setStoreValue([...selectedTools.map((tool) => ({ ...tool, isExpanded: false })), newTool])
    }

    setOpen(false)
  }

  const handleAddCustomTool = (customTool: CustomTool) => {
    if (isPreview || disabled) return

    // Check if a tool with the same name already exists
    if (
      selectedTools.some(
        (tool) =>
          tool.type === 'custom-tool' &&
          tool.schema?.function?.name === customTool.schema.function.name
      )
    ) {
      return
    }

    // Get custom tool parameters from schema
    const toolParams = getCustomToolParams(customTool.schema)

    // Create tool ID for the custom tool
    const toolId = `custom-${customTool.schema.function.name}`

    // Use the helper function to initialize parameters with blockId as instanceId
    const initialParams = initializeToolParams(
      toolId,
      toolParams,
      subBlockStore,
      isAutoFillEnvVarsEnabled,
      blockId
    )

    const newTool: StoredTool = {
      type: 'custom-tool',
      title: customTool.title,
      params: initialParams,
      isExpanded: true,
      schema: customTool.schema,
      code: customTool.code || '',
      usageControl: 'auto',
    }

    // If isWide, keep tools in the same row expanded
    if (isWide) {
      setStoreValue([
        ...selectedTools.map((tool, index) => ({
          ...tool,
          // Keep expanded if it's in the same row as the new tool
          isExpanded: Math.floor(selectedTools.length / 2) === Math.floor(index / 2),
        })),
        newTool,
      ])
    } else {
      // Original behavior for non-wide mode
      setStoreValue([...selectedTools.map((tool) => ({ ...tool, isExpanded: false })), newTool])
    }
  }

  const handleEditCustomTool = (toolIndex: number) => {
    const tool = selectedTools[toolIndex]
    if (tool.type !== 'custom-tool' || !tool.schema) return

    // Find the tool ID from the custom tools store based on the function name
    const customToolsList = useCustomToolsStore.getState().getAllTools()
    const _existingTool = customToolsList.find(
      (customTool) => customTool.schema.function.name === tool.schema.function.name
    )

    setEditingToolIndex(toolIndex)
    setCustomToolModalOpen(true)
  }

  const handleSaveCustomTool = (customTool: CustomTool) => {
    if (isPreview || disabled) return

    if (editingToolIndex !== null) {
      // Update existing tool
      setStoreValue(
        selectedTools.map((tool, index) =>
          index === editingToolIndex
            ? {
                ...tool,
                title: customTool.title,
                schema: customTool.schema,
                code: customTool.code || '',
              }
            : tool
        )
      )
      setEditingToolIndex(null)
    } else {
      // Add new tool
      handleAddCustomTool(customTool)
    }
  }

  const handleRemoveTool = (toolType: string, toolIndex: number) => {
    if (isPreview || disabled) return
    setStoreValue(selectedTools.filter((_, index) => index !== toolIndex))
  }

  // New handler for when a custom tool is completely deleted from the store
  const handleDeleteTool = (toolId: string) => {
    // Find any instances of this tool in the current workflow and remove them
    const updatedTools = selectedTools.filter((tool) => {
      // For custom tools, we need to check if it matches the deleted tool
      if (
        tool.type === 'custom-tool' &&
        tool.schema?.function?.name &&
        customTools.some(
          (customTool) =>
            customTool.id === toolId &&
            customTool.schema.function.name === tool.schema.function.name
        )
      ) {
        return false
      }
      return true
    })

    // Update the workflow value if any tools were removed
    if (updatedTools.length !== selectedTools.length) {
      setStoreValue(updatedTools)
    }
  }

  const handleParamChange = (toolIndex: number, paramId: string, paramValue: string) => {
    if (isPreview || disabled) return

    // Store the value in the tool params store for future use
    const tool = selectedTools[toolIndex]
    const toolId =
      tool.type === 'custom-tool'
        ? `custom-${tool.schema?.function?.name || 'tool'}`
        : getToolIdFromBlock(tool.type) || tool.type

    // Only store non-empty values
    if (paramValue.trim()) {
      subBlockStore.setToolParam(toolId, paramId, paramValue)
    }

    // Update the value in the workflow
    setStoreValue(
      selectedTools.map((tool, index) =>
        index === toolIndex
          ? {
              ...tool,
              params: {
                ...tool.params,
                [paramId]: paramValue,
              },
            }
          : tool
      )
    )
  }

  const handleOperationChange = (toolIndex: number, operation: string) => {
    if (isPreview || disabled) return

    const tool = selectedTools[toolIndex]
    const subBlockStore = useSubBlockStore.getState()

    // Clear fields when operation changes for Jira
    if (tool.type === 'jira') {
      // Clear all fields that might be shared between operations
      subBlockStore.setValue(blockId, 'summary', '')
      subBlockStore.setValue(blockId, 'description', '')
      subBlockStore.setValue(blockId, 'issueKey', '')
      subBlockStore.setValue(blockId, 'projectId', '')
      subBlockStore.setValue(blockId, 'parentIssue', '')
    }

    setStoreValue(
      selectedTools.map((tool, index) =>
        index === toolIndex
          ? {
              ...tool,
              operation,
              // Reset params when operation changes
              params: {},
            }
          : tool
      )
    )
  }

  const handleCredentialChange = (toolIndex: number, credentialId: string) => {
    if (isPreview || disabled) return

    setStoreValue(
      selectedTools.map((tool, index) =>
        index === toolIndex
          ? {
              ...tool,
              params: {
                ...tool.params,
                credential: credentialId,
              },
            }
          : tool
      )
    )
  }

  const handleUsageControlChange = (toolIndex: number, usageControl: string) => {
    if (isPreview || disabled) return

    setStoreValue(
      selectedTools.map((tool, index) =>
        index === toolIndex
          ? {
              ...tool,
              usageControl: usageControl as 'auto' | 'force' | 'none',
            }
          : tool
      )
    )
  }

  const toggleToolExpansion = (toolIndex: number) => {
    if (isPreview || disabled) return

    setStoreValue(
      selectedTools.map((tool, index) =>
        index === toolIndex ? { ...tool, isExpanded: !tool.isExpanded } : tool
      )
    )
  }

  const IconComponent = ({ icon: Icon, className }: { icon: any; className?: string }) => {
    if (!Icon) return null
    return <Icon className={className} />
  }

  return (
    <div className='w-full'>
      {selectedTools.length === 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <div className='flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground'>
              <div className='flex items-center text-base text-muted-foreground/50 md:text-sm'>
                <PlusIcon className='mr-2 h-4 w-4' />
                Add Tool
              </div>
            </div>
          </PopoverTrigger>
          <PopoverContent className='w-[200px] p-0' align='start'>
            <ToolCommand.Root filter={customFilter}>
              <ToolCommand.Input placeholder='Search tools...' onValueChange={setSearchQuery} />
              <ToolCommand.List>
                <ToolCommand.Empty>No tools found</ToolCommand.Empty>
                <ToolCommand.Group>
                  <ToolCommand.Item
                    value='Create Tool'
                    onSelect={() => {
                      if (!isPreview) {
                        setCustomToolModalOpen(true)
                        setOpen(false)
                      }
                    }}
                    className='mb-1 flex cursor-pointer items-center gap-2'
                    disabled={isPreview}
                  >
                    <div className='flex h-6 w-6 items-center justify-center rounded border border-muted-foreground/50 border-dashed bg-transparent'>
                      <WrenchIcon className='h-4 w-4 text-muted-foreground' />
                    </div>
                    <span>Create Tool</span>
                  </ToolCommand.Item>

                  {/* Display saved custom tools at the top */}
                  {customTools.length > 0 && (
                    <>
                      <ToolCommand.Separator />
                      <div className='px-2 pt-2.5 pb-0.5 font-medium text-muted-foreground text-xs'>
                        Custom Tools
                      </div>
                      <ToolCommand.Group className='-mx-1 -px-1'>
                        {customTools.map((customTool) => (
                          <ToolCommand.Item
                            key={customTool.id}
                            value={customTool.title}
                            onSelect={() => {
                              const newTool: StoredTool = {
                                type: 'custom-tool',
                                title: customTool.title,
                                params: {},
                                isExpanded: true,
                                schema: customTool.schema,
                                code: customTool.code,
                                usageControl: 'auto',
                              }

                              if (isWide) {
                                setStoreValue([
                                  ...selectedTools.map((tool, index) => ({
                                    ...tool,
                                    isExpanded:
                                      Math.floor(selectedTools.length / 2) ===
                                      Math.floor(index / 2),
                                  })),
                                  newTool,
                                ])
                              } else {
                                setStoreValue([
                                  ...selectedTools.map((tool) => ({
                                    ...tool,
                                    isExpanded: false,
                                  })),
                                  newTool,
                                ])
                              }
                              setOpen(false)
                            }}
                            className='flex cursor-pointer items-center gap-2'
                          >
                            <div className='flex h-6 w-6 items-center justify-center rounded bg-blue-500'>
                              <WrenchIcon className='h-4 w-4 text-white' />
                            </div>
                            <span className='max-w-[140px] truncate'>{customTool.title}</span>
                          </ToolCommand.Item>
                        ))}
                      </ToolCommand.Group>
                      <ToolCommand.Separator />
                    </>
                  )}

                  {/* Display built-in tools */}
                  {toolBlocks.some((block) => customFilter(block.name, searchQuery || '') > 0) && (
                    <>
                      <div className='px-2 pt-2.5 pb-0.5 font-medium text-muted-foreground text-xs'>
                        Built-in Tools
                      </div>
                      <ToolCommand.Group className='-mx-1 -px-1'>
                        {toolBlocks.map((block) => (
                          <ToolCommand.Item
                            key={block.type}
                            value={block.name}
                            onSelect={() => handleSelectTool(block)}
                            className='flex cursor-pointer items-center gap-2'
                          >
                            <div
                              className='flex h-6 w-6 items-center justify-center rounded'
                              style={{ backgroundColor: block.bgColor }}
                            >
                              <IconComponent icon={block.icon} className='h-4 w-4 text-white' />
                            </div>
                            <span className='max-w-[140px] truncate'>{block.name}</span>
                          </ToolCommand.Item>
                        ))}
                      </ToolCommand.Group>
                    </>
                  )}
                </ToolCommand.Group>
              </ToolCommand.List>
            </ToolCommand.Root>
          </PopoverContent>
        </Popover>
      ) : (
        <div className='flex min-h-[2.5rem] w-full flex-wrap gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background'>
          {selectedTools.map((tool, toolIndex) => {
            // Handle custom tools differently
            const isCustomTool = tool.type === 'custom-tool'
            const toolBlock = !isCustomTool
              ? toolBlocks.find((block) => block.type === tool.type)
              : null
            const toolId = !isCustomTool ? getToolIdFromBlock(tool.type) : null
            const hasOperations = !isCustomTool && hasMultipleOperations(tool.type)
            const operationOptions = hasOperations ? getOperationOptions(tool.type) : []

            // Get parameters based on tool type
            const requiredParams = isCustomTool
              ? getCustomToolParams(tool.schema)
              : toolId
                ? getFilteredToolParams(tool.type, toolId, tool.operation, tool.params)
                : []

            // Check if the tool has any expandable content
            const isExpandable = hasExpandableContent(
              isCustomTool,
              hasOperations,
              operationOptions,
              toolId,
              requiredParams
            )

            return (
              <div
                key={`${tool.type}-${toolIndex}`}
                className={cn('group flex flex-col', isWide ? 'w-[calc(50%-0.25rem)]' : 'w-full')}
              >
                <div className='flex flex-col overflow-visible rounded-md border bg-card'>
                  <div
                    className={cn(
                      'flex items-center justify-between bg-accent/50 p-2',
                      isExpandable ? 'cursor-pointer' : 'cursor-default'
                    )}
                    onClick={() => {
                      if (isCustomTool) {
                        handleEditCustomTool(toolIndex)
                      } else if (isExpandable) {
                        toggleToolExpansion(toolIndex)
                      }
                    }}
                  >
                    <div className='flex min-w-0 flex-shrink-1 items-center gap-2 overflow-hidden'>
                      <div
                        className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded'
                        style={{
                          backgroundColor: isCustomTool
                            ? '#3B82F6' // blue-500 for custom tools
                            : toolBlock?.bgColor,
                        }}
                      >
                        {isCustomTool ? (
                          <WrenchIcon className='h-3 w-3 text-white' />
                        ) : (
                          <IconComponent icon={toolBlock?.icon} className='h-3 w-3 text-white' />
                        )}
                      </div>
                      <span className='truncate font-medium text-sm'>{tool.title}</span>
                    </div>
                    <div className='ml-2 flex flex-shrink-0 items-center gap-1'>
                      {/* Only render the tool usage control if the provider supports it */}
                      {supportsToolControl && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Toggle
                              className='group flex h-6 items-center justify-center rounded-sm px-2 py-0 hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=on]:bg-transparent'
                              pressed={true}
                              onPressedChange={() => {}}
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation()
                                // Cycle through the states: auto -> force -> none -> auto
                                const currentState = tool.usageControl || 'auto'
                                const nextState =
                                  currentState === 'auto'
                                    ? 'force'
                                    : currentState === 'force'
                                      ? 'none'
                                      : 'auto'
                                handleUsageControlChange(toolIndex, nextState)
                              }}
                              aria-label='Toggle tool usage control'
                            >
                              {/* Text boxes instead of icons */}
                              <span
                                className={`font-medium text-xs ${
                                  tool.usageControl === 'auto'
                                    ? 'block text-muted-foreground'
                                    : 'hidden'
                                }`}
                              >
                                Auto
                              </span>
                              <span
                                className={`font-medium text-xs ${
                                  tool.usageControl === 'force'
                                    ? 'block text-muted-foreground'
                                    : 'hidden'
                                }`}
                              >
                                Force
                              </span>
                              <span
                                className={`font-medium text-xs ${
                                  tool.usageControl === 'none'
                                    ? 'block text-muted-foreground'
                                    : 'hidden'
                                }`}
                              >
                                Deny
                              </span>
                            </Toggle>
                          </TooltipTrigger>
                          <TooltipContent side='bottom' className='max-w-[240px] p-2'>
                            <p className='text-xs'>
                              {tool.usageControl === 'auto' && (
                                <span>
                                  <span className='font-medium'>Auto:</span> Let the agent decide
                                  when to use the tool
                                </span>
                              )}
                              {tool.usageControl === 'force' && (
                                <span>
                                  <span className='font-medium'>Force:</span> Always use this tool
                                  in the response
                                </span>
                              )}
                              {tool.usageControl === 'none' && (
                                <span>
                                  <span className='font-medium'>Deny:</span> Never use this tool
                                </span>
                              )}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveTool(tool.type, toolIndex)
                        }}
                        className='text-muted-foreground hover:text-foreground'
                      >
                        <XIcon className='h-4 w-4' />
                      </button>
                    </div>
                  </div>

                  {!isCustomTool && isExpandable && (
                    <div
                      className={cn(
                        'space-y-3 p-3 transition-all duration-200',
                        tool.isExpanded ? 'block' : 'hidden'
                      )}
                      aria-hidden={!tool.isExpanded}
                      onClick={(e) => {
                        if (e.target === e.currentTarget) {
                          toggleToolExpansion(toolIndex)
                        }
                      }}
                    >
                      {/* Add operation dropdown for tools with multiple operations */}
                      {hasOperations && operationOptions.length > 0 && (
                        <div className='relative space-y-1.5'>
                          <div className='font-medium text-muted-foreground text-xs'>Operation</div>
                          <Select
                            value={tool.operation || operationOptions[0].id}
                            onValueChange={(value) => handleOperationChange(toolIndex, value)}
                          >
                            <SelectTrigger className='w-full text-left'>
                              <SelectValue placeholder='Select operation' />
                            </SelectTrigger>
                            <SelectContent>
                              {operationOptions.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {/* Add OAuth credential selector if the tool requires OAuth */}
                      {toolId &&
                        (() => {
                          const oauthConfig = getOAuthConfig(toolId)
                          if (oauthConfig?.required) {
                            return (
                              <div className='relative space-y-1.5'>
                                <div className='font-medium text-muted-foreground text-xs'>
                                  Account
                                </div>
                                <CredentialSelector
                                  value={tool.params.credential || ''}
                                  onChange={(value) => handleCredentialChange(toolIndex, value)}
                                  provider={oauthConfig.provider as OAuthProvider}
                                  requiredScopes={oauthConfig.additionalScopes || []}
                                  label={`Select ${oauthConfig.provider} account`}
                                  serviceId={oauthConfig.provider}
                                />
                              </div>
                            )
                          }
                          return null
                        })()}

                      {/* Existing parameters */}
                      {requiredParams.map((param) => {
                        // Check if this parameter should use a channel selector
                        const useChannelSelector =
                          !isCustomTool && shouldUseChannelSelector(tool.type, param.id)
                        const channelSelectorConfig = useChannelSelector
                          ? getChannelSelectorConfig(tool.type, param.id)
                          : null

                        // Determine the correct credential to pass for channel selector
                        let credentialForChannelSelector = ''
                        if (useChannelSelector) {
                          const botToken =
                            tool.params.botToken ||
                            (subBlockStore.getValue(blockId, 'botToken') as string)
                          const oauthCredential =
                            tool.params.credential ||
                            (subBlockStore.getValue(blockId, 'credential') as string)

                          if (botToken?.trim()) {
                            credentialForChannelSelector = botToken
                          } else if (oauthCredential?.trim()) {
                            credentialForChannelSelector = oauthCredential
                          }
                        }

                        return (
                          <div key={param.id}>
                            <div className='relative space-y-1.5'>
                              <div className='flex items-center font-medium text-muted-foreground text-xs'>
                                {formatParamId(param.id)}
                                {param.optionalToolInput && !param.requiredForToolCall && (
                                  <span className='ml-1 text-muted-foreground/60 text-xs'>
                                    (Optional)
                                  </span>
                                )}
                              </div>
                              <div className='relative'>
                                {useChannelSelector && channelSelectorConfig ? (
                                  <ChannelSelectorInput
                                    blockId={blockId}
                                    subBlock={{
                                      id: param.id,
                                      type: 'channel-selector',
                                      title: channelSelectorConfig.title || formatParamId(param.id),
                                      provider: channelSelectorConfig.provider,
                                      placeholder:
                                        channelSelectorConfig.placeholder || param.description,
                                    }}
                                    credential={credentialForChannelSelector}
                                    onChannelSelect={(channelId) => {
                                      handleParamChange(toolIndex, param.id, channelId)
                                    }}
                                  />
                                ) : (
                                  <ShortInput
                                    blockId={blockId}
                                    subBlockId={`${subBlockId}-param`}
                                    placeholder={param.description}
                                    password={shouldBePasswordField(tool.type, param.id)}
                                    isConnecting={false}
                                    config={{
                                      id: `${subBlockId}-param`,
                                      type: 'short-input',
                                      title: param.id,
                                    }}
                                    value={tool.params[param.id] || ''}
                                    onChange={(value) =>
                                      handleParamChange(toolIndex, param.id, value)
                                    }
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
                className='h-6 px-2 text-muted-foreground text-xs hover:text-foreground'
              >
                <PlusIcon className='h-3 w-3' />
                Add Tool
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-[200px] p-0' align='start'>
              <ToolCommand.Root filter={customFilter}>
                <ToolCommand.Input placeholder='Search tools...' onValueChange={setSearchQuery} />
                <ToolCommand.List>
                  <ToolCommand.Empty>No tools found.</ToolCommand.Empty>
                  <ToolCommand.Group>
                    <ToolCommand.Item
                      value='Create Tool'
                      onSelect={() => {
                        setOpen(false)
                        setCustomToolModalOpen(true)
                      }}
                      className='mb-1 flex cursor-pointer items-center gap-2'
                    >
                      <div className='flex h-6 w-6 items-center justify-center rounded border border-muted-foreground/50 border-dashed bg-transparent'>
                        <WrenchIcon className='h-4 w-4 text-muted-foreground' />
                      </div>
                      <span>Create Tool</span>
                    </ToolCommand.Item>

                    {/* Display saved custom tools at the top */}
                    {customTools.length > 0 && (
                      <>
                        <ToolCommand.Separator />
                        <div className='px-2 pt-2.5 pb-0.5 font-medium text-muted-foreground text-xs'>
                          Custom Tools
                        </div>
                        <ToolCommand.Group className='-mx-1 -px-1'>
                          {customTools.map((customTool) => (
                            <ToolCommand.Item
                              key={customTool.id}
                              value={customTool.title}
                              onSelect={() => {
                                const newTool: StoredTool = {
                                  type: 'custom-tool',
                                  title: customTool.title,
                                  params: {},
                                  isExpanded: true,
                                  schema: customTool.schema,
                                  code: customTool.code,
                                  usageControl: 'auto',
                                }

                                if (isWide) {
                                  setStoreValue([
                                    ...selectedTools.map((tool, index) => ({
                                      ...tool,
                                      isExpanded:
                                        Math.floor(selectedTools.length / 2) ===
                                        Math.floor(index / 2),
                                    })),
                                    newTool,
                                  ])
                                } else {
                                  setStoreValue([
                                    ...selectedTools.map((tool) => ({
                                      ...tool,
                                      isExpanded: false,
                                    })),
                                    newTool,
                                  ])
                                }
                                setOpen(false)
                              }}
                              className='flex cursor-pointer items-center gap-2'
                            >
                              <div className='flex h-6 w-6 items-center justify-center rounded bg-blue-500'>
                                <WrenchIcon className='h-4 w-4 text-white' />
                              </div>
                              <span className='max-w-[140px] truncate'>{customTool.title}</span>
                            </ToolCommand.Item>
                          ))}
                        </ToolCommand.Group>
                        <ToolCommand.Separator />
                      </>
                    )}

                    {/* Display built-in tools */}
                    {toolBlocks.some(
                      (block) => customFilter(block.name, searchQuery || '') > 0
                    ) && (
                      <>
                        <div className='px-2 pt-2.5 pb-0.5 font-medium text-muted-foreground text-xs'>
                          Built-in Tools
                        </div>
                        <ToolCommand.Group className='-mx-1 -px-1'>
                          {toolBlocks.map((block) => (
                            <ToolCommand.Item
                              key={block.type}
                              value={block.name}
                              onSelect={() => handleSelectTool(block)}
                              className='flex cursor-pointer items-center gap-2'
                            >
                              <div
                                className='flex h-6 w-6 items-center justify-center rounded'
                                style={{ backgroundColor: block.bgColor }}
                              >
                                <IconComponent icon={block.icon} className='h-4 w-4 text-white' />
                              </div>
                              <span className='max-w-[140px] truncate'>{block.name}</span>
                            </ToolCommand.Item>
                          ))}
                        </ToolCommand.Group>
                      </>
                    )}
                  </ToolCommand.Group>
                </ToolCommand.List>
              </ToolCommand.Root>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Custom Tool Modal */}
      <CustomToolModal
        open={customToolModalOpen}
        onOpenChange={(open) => {
          setCustomToolModalOpen(open)
          if (!open) setEditingToolIndex(null)
        }}
        onSave={editingToolIndex !== null ? handleSaveCustomTool : handleAddCustomTool}
        onDelete={handleDeleteTool}
        initialValues={
          editingToolIndex !== null && selectedTools[editingToolIndex]?.type === 'custom-tool'
            ? {
                id: customTools.find(
                  (tool) =>
                    tool.schema.function.name ===
                    selectedTools[editingToolIndex].schema.function.name
                )?.id,
                schema: selectedTools[editingToolIndex].schema,
                code: selectedTools[editingToolIndex].code || '',
              }
            : undefined
        }
      />
    </div>
  )
}
