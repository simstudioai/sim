import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { PlusIcon, Server, WrenchIcon, XIcon } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Popover,
  PopoverContent,
  PopoverScrollArea,
  PopoverSearch,
  PopoverSection,
  PopoverTrigger,
  Tooltip,
} from '@/components/emcn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Toggle } from '@/components/ui/toggle'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getCanonicalScopesForProvider,
  type OAuthProvider,
  type OAuthService,
} from '@/lib/oauth/oauth'
import { cn } from '@/lib/utils'
import {
  ChannelSelectorInput,
  CheckboxList,
  Code,
  ComboBox,
  FileSelectorInput,
  FileUpload,
  LongInput,
  ProjectSelectorInput,
  ShortInput,
  SliderInput,
  Table,
  TimeInput,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components'
import {
  type CustomTool,
  CustomToolModal,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tool-input/components/custom-tool-modal/custom-tool-modal'
import { McpToolsList } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tool-input/components/mcp-tools-list'
import { ToolCommand } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tool-input/components/tool-command/tool-command'
import { ToolCredentialSelector } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tool-input/components/tool-credential-selector'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import { getAllBlocks } from '@/blocks'
import { useMcpTools } from '@/hooks/use-mcp-tools'
import { getProviderFromModel, supportsToolUsageControl } from '@/providers/utils'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import {
  formatParameterLabel,
  getToolParametersConfig,
  isPasswordParameter,
  type ToolParameterConfig,
} from '@/tools/params'

const logger = createLogger('ToolInput')

/**
 * Props for the ToolInput component
 */
interface ToolInputProps {
  /** Unique identifier for the block */
  blockId: string
  /** Unique identifier for the sub-block */
  subBlockId: string
  /** Whether component is in preview mode */
  isPreview?: boolean
  /** Value to display in preview mode */
  previewValue?: any
  /** Whether the input is disabled */
  disabled?: boolean
  /** Allow expanding tools in preview mode */
  allowExpandInPreview?: boolean
}

/**
 * Represents a tool selected and configured in the workflow
 */
interface StoredTool {
  /** Block type identifier */
  type: string
  /** Display title for the tool */
  title: string
  /** Direct tool ID for execution */
  toolId: string
  /** Parameter values configured by the user */
  params: Record<string, string>
  /** Whether the tool details are expanded in UI */
  isExpanded?: boolean
  /** Tool schema for custom tools */
  schema?: any
  /** Implementation code for custom tools */
  code?: string
  /** Selected operation for multi-operation tools */
  operation?: string
  /** Tool usage control mode for LLM */
  usageControl?: 'auto' | 'force' | 'none'
}

/**
 * Generic sync wrapper that synchronizes store values with local component state
 *
 * @remarks
 * Used to sync tool parameter values between the workflow store and local controlled inputs
 *
 * @typeParam T - The type of the store value
 */
function GenericSyncWrapper<T = unknown>({
  blockId,
  paramId,
  value,
  onChange,
  children,
  transformer,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
  transformer?: (storeValue: T) => string
}) {
  const [storeValue] = useSubBlockValue(blockId, paramId)

  useEffect(() => {
    if (storeValue) {
      const transformedValue = transformer ? transformer(storeValue) : String(storeValue)
      if (transformedValue !== value) {
        onChange(transformedValue)
      }
    }
  }, [storeValue, value, onChange, transformer])

  return <>{children}</>
}

function FileSelectorSyncWrapper({
  blockId,
  paramId,
  value,
  onChange,
  uiComponent,
  disabled,
  previewContextValues,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
  previewContextValues?: Record<string, any>
}) {
  return (
    <GenericSyncWrapper blockId={blockId} paramId={paramId} value={value} onChange={onChange}>
      <FileSelectorInput
        blockId={blockId}
        subBlock={{
          id: paramId,
          type: 'file-selector' as const,
          title: paramId,
          provider: uiComponent.provider,
          serviceId: uiComponent.serviceId,
          mimeType: uiComponent.mimeType,
          requiredScopes: uiComponent.requiredScopes || [],
          placeholder: uiComponent.placeholder,
          dependsOn: uiComponent.dependsOn,
        }}
        disabled={disabled}
        previewContextValues={previewContextValues}
      />
    </GenericSyncWrapper>
  )
}

function TableSyncWrapper({
  blockId,
  paramId,
  value,
  onChange,
  uiComponent,
  disabled,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
}) {
  return (
    <GenericSyncWrapper
      blockId={blockId}
      paramId={paramId}
      value={value}
      onChange={onChange}
      transformer={(storeValue) => JSON.stringify(storeValue)}
    >
      <Table
        blockId={blockId}
        subBlockId={paramId}
        columns={uiComponent.columns || ['Key', 'Value']}
        disabled={disabled}
      />
    </GenericSyncWrapper>
  )
}

function TimeInputSyncWrapper({
  blockId,
  paramId,
  value,
  onChange,
  uiComponent,
  disabled,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
}) {
  return (
    <GenericSyncWrapper blockId={blockId} paramId={paramId} value={value} onChange={onChange}>
      <TimeInput
        blockId={blockId}
        subBlockId={paramId}
        placeholder={uiComponent.placeholder}
        disabled={disabled}
      />
    </GenericSyncWrapper>
  )
}

function SliderInputSyncWrapper({
  blockId,
  paramId,
  value,
  onChange,
  uiComponent,
  disabled,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
}) {
  return (
    <GenericSyncWrapper
      blockId={blockId}
      paramId={paramId}
      value={value}
      onChange={onChange}
      transformer={(storeValue) => String(storeValue)}
    >
      <SliderInput
        blockId={blockId}
        subBlockId={paramId}
        min={uiComponent.min}
        max={uiComponent.max}
        step={uiComponent.step}
        integer={uiComponent.integer}
        disabled={disabled}
      />
    </GenericSyncWrapper>
  )
}

function CheckboxListSyncWrapper({
  blockId,
  paramId,
  value,
  onChange,
  uiComponent,
  disabled,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
}) {
  return (
    <GenericSyncWrapper
      blockId={blockId}
      paramId={paramId}
      value={value}
      onChange={onChange}
      transformer={(storeValue) => JSON.stringify(storeValue)}
    >
      <CheckboxList
        blockId={blockId}
        subBlockId={paramId}
        title={uiComponent.title || paramId}
        options={uiComponent.options || []}
        disabled={disabled}
      />
    </GenericSyncWrapper>
  )
}

function CodeSyncWrapper({
  blockId,
  paramId,
  value,
  onChange,
  uiComponent,
  disabled,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
}) {
  return (
    <GenericSyncWrapper blockId={blockId} paramId={paramId} value={value} onChange={onChange}>
      <Code
        blockId={blockId}
        subBlockId={paramId}
        language={uiComponent.language}
        generationType={uiComponent.generationType}
        disabled={disabled}
        wandConfig={{
          enabled: false,
          prompt: '',
        }}
      />
    </GenericSyncWrapper>
  )
}

function ComboboxSyncWrapper({
  blockId,
  paramId,
  value,
  onChange,
  uiComponent,
  disabled,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
}) {
  return (
    <GenericSyncWrapper blockId={blockId} paramId={paramId} value={value} onChange={onChange}>
      <ComboBox
        blockId={blockId}
        subBlockId={paramId}
        options={uiComponent.options || []}
        placeholder={uiComponent.placeholder}
        config={{
          id: paramId,
          type: 'combobox' as const,
          title: paramId,
        }}
        disabled={disabled}
      />
    </GenericSyncWrapper>
  )
}

function FileUploadSyncWrapper({
  blockId,
  paramId,
  value,
  onChange,
  uiComponent,
  disabled,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
}) {
  return (
    <GenericSyncWrapper
      blockId={blockId}
      paramId={paramId}
      value={value}
      onChange={onChange}
      transformer={(storeValue) => JSON.stringify(storeValue)}
    >
      <FileUpload
        blockId={blockId}
        subBlockId={paramId}
        acceptedTypes={uiComponent.acceptedTypes}
        multiple={uiComponent.multiple}
        maxSize={uiComponent.maxSize}
        disabled={disabled}
      />
    </GenericSyncWrapper>
  )
}

function ChannelSelectorSyncWrapper({
  blockId,
  paramId,
  value,
  onChange,
  uiComponent,
  disabled,
  previewContextValues,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  uiComponent: any
  disabled: boolean
  previewContextValues?: Record<string, any>
}) {
  return (
    <GenericSyncWrapper blockId={blockId} paramId={paramId} value={value} onChange={onChange}>
      <ChannelSelectorInput
        blockId={blockId}
        subBlock={{
          id: paramId,
          type: 'channel-selector' as const,
          title: paramId,
          provider: uiComponent.provider || 'slack',
          placeholder: uiComponent.placeholder,
          dependsOn: uiComponent.dependsOn,
        }}
        onChannelSelect={onChange}
        disabled={disabled}
        previewContextValues={previewContextValues}
      />
    </GenericSyncWrapper>
  )
}

/**
 * Tool input component for selecting and configuring LLM tools in workflows
 *
 * @remarks
 * - Supports built-in tools, custom tools, and MCP server tools
 * - Handles tool parameter configuration with dynamic UI components
 * - Supports multi-operation tools with operation selection
 * - Provides OAuth credential management for tools requiring authentication
 * - Allows drag-and-drop reordering of selected tools
 * - Supports tool usage control (auto/force/none) for compatible LLM providers
 */
export function ToolInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  allowExpandInPreview,
}: ToolInputProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)
  const [open, setOpen] = useState(false)
  const [customToolModalOpen, setCustomToolModalOpen] = useState(false)
  const [editingToolIndex, setEditingToolIndex] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const customTools = useCustomToolsStore((state) => state.getAllTools())
  const subBlockStore = useSubBlockStore()

  // MCP tools integration
  const {
    mcpTools,
    isLoading: mcpLoading,
    error: mcpError,
    refreshTools,
  } = useMcpTools(workspaceId)

  // Get the current model from the 'model' subblock
  const modelValue = useSubBlockStore.getState().getValue(blockId, 'model')
  const model = typeof modelValue === 'string' ? modelValue : ''
  const provider = model ? getProviderFromModel(model) : ''
  const supportsToolControl = provider ? supportsToolUsageControl(provider) : false

  const toolBlocks = getAllBlocks().filter(
    (block) => block.category === 'tools' && block.type !== 'evaluator'
  )

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

  /**
   * Checks if a tool is already selected in the current workflow
   * @param toolId - The tool identifier to check
   * @param blockType - The block type for the tool
   * @returns True if tool is already selected (for single-operation tools only)
   */
  const isToolAlreadySelected = (toolId: string, blockType: string) => {
    if (hasMultipleOperations(blockType)) {
      return false
    }
    return selectedTools.some((tool) => tool.toolId === toolId)
  }

  /**
   * Checks if a block supports multiple operations
   * @param blockType - The block type to check
   * @returns True if the block has multiple tool operations
   */
  const hasMultipleOperations = (blockType: string): boolean => {
    const block = getAllBlocks().find((block) => block.type === blockType)
    return (block?.tools?.access?.length || 0) > 1
  }

  /**
   * Gets the available operation options for a multi-operation tool
   * @param blockType - The block type to get operations for
   * @returns Array of operation options with label and id
   */
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
      try {
        const toolParams = getToolParametersConfig(toolId)
        return {
          id: toolId,
          label: toolParams?.toolConfig?.name || toolId,
        }
      } catch (error) {
        logger.error(`Error getting tool config for ${toolId}:`, error)
        return {
          id: toolId,
          label: toolId,
        }
      }
    })
  }

  /**
   * Gets the correct tool ID for a given operation
   * @param blockType - The block type
   * @param operation - The selected operation (for multi-operation tools)
   * @returns The tool ID to use for execution, or undefined if not found
   */
  const getToolIdForOperation = (blockType: string, operation?: string): string | undefined => {
    const block = getAllBlocks().find((block) => block.type === blockType)
    if (!block || !block.tools?.access) return undefined

    // If there's only one tool, return it
    if (block.tools.access.length === 1) {
      return block.tools.access[0]
    }

    // If there's an operation and a tool selection function, use it
    if (operation && block.tools?.config?.tool) {
      try {
        return block.tools.config.tool({ operation })
      } catch (error) {
        logger.error('Error selecting tool for operation:', error)
      }
    }

    // If there's an operation that matches a tool ID, use it
    if (operation && block.tools.access.includes(operation)) {
      return operation
    }

    // Default to first tool
    return block.tools.access[0]
  }

  /**
   * Initializes tool parameters with empty values
   * @param toolId - The tool identifier
   * @param params - Array of parameter configurations
   * @param instanceId - Optional instance identifier
   * @returns Empty parameter object
   */
  const initializeToolParams = (
    toolId: string,
    params: ToolParameterConfig[],
    instanceId?: string
  ): Record<string, string> => {
    return {}
  }

  const handleSelectTool = useCallback(
    (toolBlock: (typeof toolBlocks)[0]) => {
      if (isPreview || disabled) return

      const hasOperations = hasMultipleOperations(toolBlock.type)
      const operationOptions = hasOperations ? getOperationOptions(toolBlock.type) : []
      const defaultOperation = operationOptions.length > 0 ? operationOptions[0].id : undefined

      const toolId = getToolIdForOperation(toolBlock.type, defaultOperation)
      if (!toolId) return

      // Check if tool is already selected
      if (isToolAlreadySelected(toolId, toolBlock.type)) return

      // Get tool parameters using the new utility with block type for UI components
      const toolParams = getToolParametersConfig(toolId, toolBlock.type)
      if (!toolParams) return

      // Initialize parameters with auto-fill and default values
      const initialParams = initializeToolParams(toolId, toolParams.userInputParameters, blockId)

      // Add default values from UI component configurations
      toolParams.userInputParameters.forEach((param) => {
        if (param.uiComponent?.value && !initialParams[param.id]) {
          const defaultValue =
            typeof param.uiComponent.value === 'function'
              ? param.uiComponent.value()
              : param.uiComponent.value
          initialParams[param.id] = defaultValue
        }
      })

      const newTool: StoredTool = {
        type: toolBlock.type,
        title: toolBlock.name,
        toolId: toolId,
        params: initialParams,
        isExpanded: true,
        operation: defaultOperation,
        usageControl: 'auto',
      }

      // Add tool to selection
      setStoreValue([...selectedTools.map((tool) => ({ ...tool, isExpanded: false })), newTool])

      setOpen(false)
    },
    [
      isPreview,
      disabled,
      hasMultipleOperations,
      getOperationOptions,
      getToolIdForOperation,
      isToolAlreadySelected,
      initializeToolParams,
      blockId,
      selectedTools,
      setStoreValue,
    ]
  )

  const handleAddCustomTool = useCallback(
    (customTool: CustomTool) => {
      if (isPreview || disabled) return

      const customToolId = `custom-${customTool.schema.function.name}`

      const newTool: StoredTool = {
        type: 'custom-tool',
        title: customTool.title,
        toolId: customToolId,
        params: {},
        isExpanded: true,
        schema: customTool.schema,
        code: customTool.code || '',
        usageControl: 'auto',
      }

      // Add tool to selection
      setStoreValue([...selectedTools.map((tool) => ({ ...tool, isExpanded: false })), newTool])
    },
    [isPreview, disabled, selectedTools, setStoreValue]
  )

  const handleEditCustomTool = useCallback(
    (toolIndex: number) => {
      const tool = selectedTools[toolIndex]
      if (tool.type !== 'custom-tool' || !tool.schema) return

      setEditingToolIndex(toolIndex)
      setCustomToolModalOpen(true)
    },
    [selectedTools]
  )

  const handleSaveCustomTool = useCallback(
    (customTool: CustomTool) => {
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
    },
    [isPreview, disabled, editingToolIndex, selectedTools, setStoreValue, handleAddCustomTool]
  )

  const handleRemoveTool = useCallback(
    (toolIndex: number) => {
      if (isPreview || disabled) return
      setStoreValue(selectedTools.filter((_, index) => index !== toolIndex))
    },
    [isPreview, disabled, selectedTools, setStoreValue]
  )

  const handleDeleteTool = useCallback(
    (toolId: string) => {
      // Find any instances of this tool in the current workflow and remove them
      const updatedTools = selectedTools.filter((tool) => {
        // For custom tools, check if it matches the deleted tool
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
    },
    [selectedTools, customTools, setStoreValue]
  )

  const handleParamChange = useCallback(
    (toolIndex: number, paramId: string, paramValue: string) => {
      if (isPreview || disabled) return

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
    },
    [isPreview, disabled, selectedTools, setStoreValue]
  )

  const handleOperationChange = useCallback(
    (toolIndex: number, operation: string) => {
      if (isPreview || disabled) {
        logger.info('❌ Early return: preview or disabled')
        return
      }

      const tool = selectedTools[toolIndex]

      const newToolId = getToolIdForOperation(tool.type, operation)

      if (!newToolId) {
        logger.info('❌ Early return: no newToolId')
        return
      }

      // Get parameters for the new tool
      const toolParams = getToolParametersConfig(newToolId, tool.type)

      if (!toolParams) {
        logger.info('❌ Early return: no toolParams')
        return
      }

      // Initialize parameters for the new operation
      const initialParams = initializeToolParams(newToolId, toolParams.userInputParameters, blockId)

      // Preserve ALL existing parameters that also exist in the new tool configuration
      // This mimics how regular blocks work - each field maintains its state independently
      const oldToolParams = getToolParametersConfig(tool.toolId, tool.type)
      const oldParamIds = new Set(oldToolParams?.userInputParameters.map((p) => p.id) || [])
      const newParamIds = new Set(toolParams.userInputParameters.map((p) => p.id))

      // Preserve any parameter that exists in both configurations and has a value
      const preservedParams: Record<string, string> = {}
      Object.entries(tool.params).forEach(([paramId, value]) => {
        if (newParamIds.has(paramId) && value) {
          preservedParams[paramId] = value
        }
      })

      // Clear fields when operation changes for Jira (special case)
      if (tool.type === 'jira') {
        const subBlockStore = useSubBlockStore.getState()
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
                toolId: newToolId,
                operation,
                params: { ...initialParams, ...preservedParams }, // Preserve all compatible existing values
              }
            : tool
        )
      )
    },
    [
      isPreview,
      disabled,
      selectedTools,
      getToolIdForOperation,
      initializeToolParams,
      blockId,
      setStoreValue,
    ]
  )

  const handleUsageControlChange = useCallback(
    (toolIndex: number, usageControl: string) => {
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
    },
    [isPreview, disabled, selectedTools, setStoreValue]
  )

  // Local expansion overrides for preview/diff mode
  const [previewExpanded, setPreviewExpanded] = useState<Record<number, boolean>>({})

  const toggleToolExpansion = (toolIndex: number) => {
    if ((isPreview && !allowExpandInPreview) || disabled) return

    if (isPreview) {
      setPreviewExpanded((prev) => ({
        ...prev,
        [toolIndex]: !(prev[toolIndex] ?? !!selectedTools[toolIndex]?.isExpanded),
      }))
      return
    }

    setStoreValue(
      selectedTools.map((tool, index) =>
        index === toolIndex ? { ...tool, isExpanded: !tool.isExpanded } : tool
      )
    )
  }

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (isPreview || disabled) return
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/html', '')
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    if (isPreview || disabled || draggedIndex === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleMcpToolSelect = (newTool: StoredTool, closePopover = true) => {
    setStoreValue([
      ...selectedTools.map((tool) => ({
        ...tool,
        isExpanded: false,
      })),
      newTool,
    ])

    if (closePopover) {
      setOpen(false)
    }
  }

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    if (isPreview || disabled || draggedIndex === null || draggedIndex === dropIndex) return
    e.preventDefault()

    const newTools = [...selectedTools]
    const draggedTool = newTools[draggedIndex]

    newTools.splice(draggedIndex, 1)

    if (dropIndex === selectedTools.length) {
      newTools.push(draggedTool)
    } else {
      const adjustedDropIndex = draggedIndex < dropIndex ? dropIndex - 1 : dropIndex
      newTools.splice(adjustedDropIndex, 0, draggedTool)
    }

    setStoreValue(newTools)
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const IconComponent = ({ icon: Icon, className }: { icon: any; className?: string }) => {
    if (!Icon) return null
    return <Icon className={className} />
  }

  // Check if tool has OAuth requirements
  const toolRequiresOAuth = (toolId: string): boolean => {
    const toolParams = getToolParametersConfig(toolId)
    return toolParams?.toolConfig?.oauth?.required || false
  }

  // Get OAuth configuration for tool
  const getToolOAuthConfig = (toolId: string) => {
    const toolParams = getToolParametersConfig(toolId)
    return toolParams?.toolConfig?.oauth
  }

  /**
   * Evaluates parameter conditions to determine if a parameter should be visible
   * @param param - The parameter configuration with optional condition
   * @param tool - The current tool instance with its values
   * @returns True if the parameter should be shown based on its condition
   */
  const evaluateParameterCondition = (param: any, tool: StoredTool): boolean => {
    if (!('uiComponent' in param) || !param.uiComponent?.condition) return true

    const condition = param.uiComponent.condition
    const currentValues: Record<string, any> = {
      operation: tool.operation,
      ...tool.params,
    }

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

    // Handle 'and' conditions
    if (condition.and) {
      const andFieldValue = currentValues[condition.and.field]
      let andResult = false

      if (Array.isArray(condition.and.value)) {
        andResult = condition.and.value.includes(andFieldValue)
      } else {
        andResult = andFieldValue === condition.and.value
      }

      if (condition.and.not) {
        andResult = !andResult
      }

      result = result && andResult
    }

    return result
  }

  /**
   * Renders the appropriate UI component for a tool parameter
   * @param param - The parameter configuration
   * @param value - The current parameter value
   * @param onChange - Callback to handle value changes
   * @param toolIndex - Index of the tool in the selected tools array
   * @param currentToolParams - Current values of all tool parameters
   * @returns JSX element for the parameter input
   */
  const renderParameterInput = (
    param: ToolParameterConfig,
    value: string,
    onChange: (value: string) => void,
    toolIndex?: number,
    currentToolParams?: Record<string, string>
  ) => {
    // Create unique subBlockId for tool parameters to avoid conflicts
    // Use real blockId so tag dropdown and drag-drop work correctly
    const uniqueSubBlockId =
      toolIndex !== undefined
        ? `${subBlockId}-tool-${toolIndex}-${param.id}`
        : `${subBlockId}-${param.id}`
    const uiComponent = param.uiComponent

    // If no UI component info, fall back to basic input
    if (!uiComponent) {
      return (
        <ShortInput
          blockId={blockId}
          subBlockId={uniqueSubBlockId}
          placeholder={param.description}
          password={isPasswordParameter(param.id)}
          config={{
            id: uniqueSubBlockId,
            type: 'short-input',
            title: param.id,
          }}
          value={value}
          onChange={onChange}
        />
      )
    }

    // Render based on UI component type
    switch (uiComponent.type) {
      case 'dropdown':
        return (
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger className='w-full rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F] px-[10px] py-[8px] text-left font-medium text-sm'>
              <SelectValue
                placeholder={uiComponent.placeholder || 'Select option'}
                className='truncate'
              />
            </SelectTrigger>
            <SelectContent className='border-[var(--border-strong)] bg-[#1F1F1F]'>
              {uiComponent.options
                ?.filter((option: any) => option.id !== '')
                .map((option: any) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )

      case 'switch':
        return (
          <Switch
            checked={value === 'true' || value === 'True'}
            onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
          />
        )

      case 'long-input':
        return (
          <LongInput
            blockId={blockId}
            subBlockId={uniqueSubBlockId}
            placeholder={uiComponent.placeholder || param.description}
            config={{
              id: uniqueSubBlockId,
              type: 'long-input',
              title: param.id,
            }}
            value={value}
            onChange={onChange}
          />
        )

      case 'short-input':
        return (
          <ShortInput
            blockId={blockId}
            subBlockId={uniqueSubBlockId}
            placeholder={uiComponent.placeholder || param.description}
            password={uiComponent.password || isPasswordParameter(param.id)}
            config={{
              id: uniqueSubBlockId,
              type: 'short-input',
              title: param.id,
            }}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        )

      case 'channel-selector':
        return (
          <ChannelSelectorSyncWrapper
            blockId={blockId}
            paramId={param.id}
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
            previewContextValues={currentToolParams as any}
          />
        )

      case 'project-selector':
        return (
          <ProjectSelectorInput
            blockId={blockId}
            subBlock={{
              id: `tool-${toolIndex || 0}-${param.id}`,
              type: 'project-selector' as const,
              title: param.id,
              provider: uiComponent.provider || 'jira',
              serviceId: uiComponent.serviceId,
              placeholder: uiComponent.placeholder,
              requiredScopes: uiComponent.requiredScopes,
              dependsOn: uiComponent.dependsOn,
            }}
            onProjectSelect={onChange}
            disabled={disabled}
            previewContextValues={currentToolParams as any}
          />
        )

      case 'oauth-input':
        return (
          <ToolCredentialSelector
            value={value}
            onChange={onChange}
            provider={(uiComponent.provider || uiComponent.serviceId) as OAuthProvider}
            serviceId={uiComponent.serviceId as OAuthService}
            disabled={disabled}
            requiredScopes={uiComponent.requiredScopes || []}
          />
        )

      case 'file-selector':
        return (
          <FileSelectorSyncWrapper
            blockId={blockId}
            paramId={param.id}
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
            previewContextValues={currentToolParams as any}
          />
        )

      case 'table':
        return (
          <TableSyncWrapper
            blockId={blockId}
            paramId={param.id}
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
          />
        )

      case 'combobox':
        return (
          <ComboboxSyncWrapper
            blockId={blockId}
            paramId={param.id}
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
          />
        )

      case 'slider':
        return (
          <SliderInputSyncWrapper
            blockId={blockId}
            paramId={uniqueSubBlockId}
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
          />
        )

      case 'code':
        return (
          <CodeSyncWrapper
            blockId={blockId}
            paramId={param.id}
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
          />
        )

      case 'checkbox-list':
        return (
          <CheckboxListSyncWrapper
            blockId={blockId}
            paramId={param.id}
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
          />
        )

      case 'time-input':
        return (
          <TimeInputSyncWrapper
            blockId={blockId}
            paramId={param.id}
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
          />
        )

      case 'file-upload':
        return (
          <FileUploadSyncWrapper
            blockId={blockId}
            paramId={param.id}
            value={value}
            onChange={onChange}
            uiComponent={uiComponent}
            disabled={disabled}
          />
        )

      default:
        return (
          <ShortInput
            blockId={blockId}
            subBlockId={uniqueSubBlockId}
            placeholder={uiComponent.placeholder || param.description}
            password={uiComponent.password || isPasswordParameter(param.id)}
            config={{
              id: uniqueSubBlockId,
              type: 'short-input',
              title: param.id,
            }}
            value={value}
            onChange={onChange}
          />
        )
    }
  }

  return (
    <div className='w-full space-y-[8px]'>
      {selectedTools.length === 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <div className='flex w-full cursor-pointer items-center justify-center rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F] px-[10px] py-[6px] font-medium text-sm transition-colors hover:bg-[var(--surface-4)]'>
              <div className='flex items-center text-[13px] text-[var(--text-muted)]'>
                <PlusIcon className='mr-2 h-4 w-4' />
                Add Tool
              </div>
            </div>
          </PopoverTrigger>
          <PopoverContent
            maxHeight={240}
            className='w-[var(--radix-popover-trigger-width)]'
            align='start'
            sideOffset={6}
          >
            <PopoverSearch placeholder='Search tools...' onValueChange={setSearchQuery} />
            <PopoverScrollArea>
              <ToolCommand.Root filter={customFilter} searchQuery={searchQuery}>
                <ToolCommand.List>
                  <ToolCommand.Empty>No tools found</ToolCommand.Empty>

                  <ToolCommand.Item
                    value='Create Tool'
                    onSelect={() => {
                      if (!isPreview) {
                        setCustomToolModalOpen(true)
                        setOpen(false)
                      }
                    }}
                    disabled={isPreview}
                  >
                    <div className='flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded border border-muted-foreground/50 border-dashed bg-transparent'>
                      <WrenchIcon className='h-[11px] w-[11px] text-muted-foreground' />
                    </div>
                    <span className='truncate'>Create Tool</span>
                  </ToolCommand.Item>

                  <ToolCommand.Item
                    value='Add MCP Server'
                    onSelect={() => {
                      if (!isPreview) {
                        setOpen(false)
                        window.dispatchEvent(
                          new CustomEvent('open-settings', { detail: { tab: 'mcp' } })
                        )
                      }
                    }}
                    disabled={isPreview}
                  >
                    <div className='flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded border border-muted-foreground/50 border-dashed bg-transparent'>
                      <Server className='h-[11px] w-[11px] text-muted-foreground' />
                    </div>
                    <span className='truncate'>Add MCP Server</span>
                  </ToolCommand.Item>

                  {/* Display saved custom tools at the top */}
                  {(() => {
                    const matchingCustomTools = customTools.filter(
                      (tool) => customFilter(tool.title, searchQuery || '') > 0
                    )
                    if (matchingCustomTools.length === 0) return null

                    return (
                      <>
                        <PopoverSection>Custom Tools</PopoverSection>
                        {matchingCustomTools.map((customTool) => (
                          <ToolCommand.Item
                            key={customTool.id}
                            value={customTool.title}
                            onSelect={() => {
                              const newTool: StoredTool = {
                                type: 'custom-tool',
                                title: customTool.title,
                                toolId: `custom-${customTool.schema.function.name}`,
                                params: {},
                                isExpanded: true,
                                schema: customTool.schema,
                                code: customTool.code,
                                usageControl: 'auto',
                              }

                              setStoreValue([
                                ...selectedTools.map((tool) => ({
                                  ...tool,
                                  isExpanded: false,
                                })),
                                newTool,
                              ])
                              setOpen(false)
                            }}
                          >
                            <div className='flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded bg-blue-500'>
                              <WrenchIcon className='h-[11px] w-[11px] text-white' />
                            </div>
                            <span className='truncate'>{customTool.title}</span>
                          </ToolCommand.Item>
                        ))}
                      </>
                    )
                  })()}

                  {/* Display MCP tools */}
                  <McpToolsList
                    mcpTools={mcpTools}
                    searchQuery={searchQuery || ''}
                    customFilter={customFilter}
                    onToolSelect={handleMcpToolSelect}
                    disabled={isPreview || disabled}
                  />

                  {/* Display built-in tools */}
                  {(() => {
                    const matchingBlocks = toolBlocks.filter(
                      (block) => customFilter(block.name, searchQuery || '') > 0
                    )
                    if (matchingBlocks.length === 0) return null

                    return (
                      <>
                        <PopoverSection>Built-in Tools</PopoverSection>
                        {matchingBlocks.map((block) => (
                          <ToolCommand.Item
                            key={block.type}
                            value={block.name}
                            onSelect={() => handleSelectTool(block)}
                          >
                            <div
                              className='flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded'
                              style={{ backgroundColor: block.bgColor }}
                            >
                              <IconComponent
                                icon={block.icon}
                                className='h-[11px] w-[11px] text-white'
                              />
                            </div>
                            <span className='truncate'>{block.name}</span>
                          </ToolCommand.Item>
                        ))}
                      </>
                    )
                  })()}
                </ToolCommand.List>
              </ToolCommand.Root>
            </PopoverScrollArea>
          </PopoverContent>
        </Popover>
      ) : (
        <>
          {selectedTools.map((tool, toolIndex) => {
            // Handle custom tools and MCP tools differently
            const isCustomTool = tool.type === 'custom-tool'
            const isMcpTool = tool.type === 'mcp'
            const toolBlock =
              !isCustomTool && !isMcpTool
                ? toolBlocks.find((block) => block.type === tool.type)
                : null

            // Get the current tool ID (may change based on operation)
            const currentToolId =
              !isCustomTool && !isMcpTool
                ? getToolIdForOperation(tool.type, tool.operation) || tool.toolId
                : tool.toolId

            // Get tool parameters using the new utility with block type for UI components
            const toolParams =
              !isCustomTool && !isMcpTool ? getToolParametersConfig(currentToolId, tool.type) : null

            // For custom tools, extract parameters from schema
            const customToolParams =
              isCustomTool && tool.schema && tool.schema.function?.parameters?.properties
                ? Object.entries(tool.schema.function.parameters.properties || {}).map(
                    ([paramId, param]: [string, any]) => ({
                      id: paramId,
                      type: param.type || 'string',
                      description: param.description || '',
                      visibility: (tool.schema.function.parameters.required?.includes(paramId)
                        ? 'user-or-llm'
                        : 'user-only') as 'user-or-llm' | 'user-only' | 'llm-only' | 'hidden',
                    })
                  )
                : []

            // For MCP tools, extract parameters from input schema
            // Use cached schema from tool object if available, otherwise fetch from mcpTools
            const mcpTool = isMcpTool ? mcpTools.find((t) => t.id === tool.toolId) : null
            const mcpToolSchema = isMcpTool ? tool.schema || mcpTool?.inputSchema : null
            const mcpToolParams =
              isMcpTool && mcpToolSchema?.properties
                ? Object.entries(mcpToolSchema.properties || {}).map(
                    ([paramId, param]: [string, any]) => ({
                      id: paramId,
                      type: param.type || 'string',
                      description: param.description || '',
                      visibility: (mcpToolSchema.required?.includes(paramId)
                        ? 'user-or-llm'
                        : 'user-only') as 'user-or-llm' | 'user-only' | 'llm-only' | 'hidden',
                    })
                  )
                : []

            // Get all parameters to display
            const displayParams = isCustomTool
              ? customToolParams
              : isMcpTool
                ? mcpToolParams
                : toolParams?.userInputParameters || []

            // Check if tool requires OAuth
            const requiresOAuth = !isCustomTool && !isMcpTool && toolRequiresOAuth(currentToolId)
            const oauthConfig =
              !isCustomTool && !isMcpTool ? getToolOAuthConfig(currentToolId) : null

            // Tools are always expandable so users can access the interface
            const isExpandedForDisplay = isPreview
              ? (previewExpanded[toolIndex] ?? !!tool.isExpanded)
              : !!tool.isExpanded

            return (
              <div
                key={`${tool.toolId}-${toolIndex}`}
                className={cn(
                  'group relative flex flex-col overflow-visible rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F] transition-all duration-200 ease-in-out',
                  draggedIndex === toolIndex ? 'scale-95 opacity-40' : '',
                  dragOverIndex === toolIndex && draggedIndex !== toolIndex && draggedIndex !== null
                    ? 'translate-y-1 transform border-t-2 border-t-muted-foreground/40'
                    : '',
                  selectedTools.length > 1 && !isPreview && !disabled
                    ? 'cursor-grab active:cursor-grabbing'
                    : ''
                )}
                draggable={!isPreview && !disabled}
                onDragStart={(e) => handleDragStart(e, toolIndex)}
                onDragOver={(e) => handleDragOver(e, toolIndex)}
                onDragEnd={handleDragEnd}
                onDrop={(e) => handleDrop(e, toolIndex)}
              >
                <div
                  className={cn(
                    'flex items-center justify-between px-[10px] py-[8px]',
                    isExpandedForDisplay &&
                      !isCustomTool &&
                      'border-[var(--border-strong)] border-b',
                    'cursor-pointer'
                  )}
                  onClick={() => {
                    if (isCustomTool) {
                      handleEditCustomTool(toolIndex)
                    } else {
                      toggleToolExpansion(toolIndex)
                    }
                  }}
                >
                  <div className='flex min-w-0 flex-1 items-center gap-[10px]'>
                    <div
                      className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center rounded-[4px]'
                      style={{
                        backgroundColor: isCustomTool
                          ? '#3B82F6'
                          : isMcpTool
                            ? mcpTool?.bgColor || '#6366F1'
                            : toolBlock?.bgColor,
                      }}
                    >
                      {isCustomTool ? (
                        <WrenchIcon className='h-[10px] w-[10px] text-white' />
                      ) : isMcpTool ? (
                        <IconComponent icon={Server} className='h-[10px] w-[10px] text-white' />
                      ) : (
                        <IconComponent
                          icon={toolBlock?.icon}
                          className='h-[10px] w-[10px] text-white'
                        />
                      )}
                    </div>
                    <span className='truncate font-medium text-[#EEEEEE] text-[13px]'>
                      {tool.title}
                    </span>
                  </div>
                  <div className='flex flex-shrink-0 items-center gap-[8px]'>
                    {supportsToolControl && (
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <Toggle
                            className='group flex h-auto items-center justify-center rounded-sm p-0 hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=on]:bg-transparent'
                            pressed={true}
                            onPressedChange={() => {}}
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation()
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
                            <span
                              className={`font-medium text-[var(--text-tertiary)] text-xs ${
                                tool.usageControl === 'auto' ? 'block' : 'hidden'
                              }`}
                            >
                              Auto
                            </span>
                            <span
                              className={`font-medium text-[var(--text-tertiary)] text-xs ${
                                tool.usageControl === 'force' ? 'block' : 'hidden'
                              }`}
                            >
                              Force
                            </span>
                            <span
                              className={`font-medium text-[var(--text-tertiary)] text-xs ${
                                tool.usageControl === 'none' ? 'block' : 'hidden'
                              }`}
                            >
                              None
                            </span>
                          </Toggle>
                        </Tooltip.Trigger>
                        <Tooltip.Content className='max-w-[280px] p-2' side='top'>
                          <p className='text-xs'>
                            {tool.usageControl === 'auto' && (
                              <span>
                                <span className='font-medium'>Auto:</span> The model decides when to
                                use the tool
                              </span>
                            )}
                            {tool.usageControl === 'force' && (
                              <span>
                                <span className='font-medium'>Force:</span> Always use this tool in
                                the response
                              </span>
                            )}
                            {tool.usageControl === 'none' && (
                              <span>
                                <span className='font-medium'>Deny:</span> Never use this tool
                              </span>
                            )}
                          </p>
                        </Tooltip.Content>
                      </Tooltip.Root>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemoveTool(toolIndex)
                      }}
                      className='text-[var(--text-tertiary)] transition-colors hover:text-[#EEEEEE]'
                      aria-label='Remove tool'
                    >
                      <XIcon className='h-[14px] w-[14px]' />
                    </button>
                  </div>
                </div>

                {!isCustomTool && isExpandedForDisplay && (
                  <div className='space-y-[12px] overflow-visible p-[10px]'>
                    {/* Operation dropdown for tools with multiple operations */}
                    {(() => {
                      const hasOperations = hasMultipleOperations(tool.type)
                      const operationOptions = hasOperations ? getOperationOptions(tool.type) : []

                      return hasOperations && operationOptions.length > 0 ? (
                        <div className='relative min-w-0 space-y-[6px]'>
                          <div className='font-medium text-[13px] text-[var(--text-tertiary)]'>
                            Operation
                          </div>
                          <div className='w-full min-w-0'>
                            <Select
                              value={tool.operation || operationOptions[0].id}
                              onValueChange={(value) => handleOperationChange(toolIndex, value)}
                            >
                              <SelectTrigger className='w-full min-w-0 rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F] px-[10px] py-[8px] text-left font-medium text-sm'>
                                <SelectValue placeholder='Select operation' className='truncate' />
                              </SelectTrigger>
                              <SelectContent className='border-[var(--border-strong)] bg-[#1F1F1F]'>
                                {operationOptions
                                  .filter((option) => option.id !== '')
                                  .map((option) => (
                                    <SelectItem key={option.id} value={option.id}>
                                      {option.label}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      ) : null
                    })()}

                    {/* OAuth credential selector if required */}
                    {requiresOAuth && oauthConfig && (
                      <div className='relative min-w-0 space-y-[6px]'>
                        <div className='font-medium text-[13px] text-[var(--text-tertiary)]'>
                          Account
                        </div>
                        <div className='w-full min-w-0'>
                          <ToolCredentialSelector
                            value={tool.params.credential || ''}
                            onChange={(value) => handleParamChange(toolIndex, 'credential', value)}
                            provider={oauthConfig.provider as OAuthProvider}
                            requiredScopes={getCanonicalScopesForProvider(oauthConfig.provider)}
                            label={`Select ${oauthConfig.provider} account`}
                            serviceId={oauthConfig.provider}
                            disabled={disabled}
                          />
                        </div>
                      </div>
                    )}

                    {/* Tool parameters */}
                    {(() => {
                      const filteredParams = displayParams.filter((param) =>
                        evaluateParameterCondition(param, tool)
                      )
                      const groupedParams: { [key: string]: ToolParameterConfig[] } = {}
                      const standaloneParams: ToolParameterConfig[] = []

                      // Group checkbox-list parameters by their UI component title
                      filteredParams.forEach((param) => {
                        const paramConfig = param as ToolParameterConfig
                        if (
                          paramConfig.uiComponent?.type === 'checkbox-list' &&
                          paramConfig.uiComponent?.title
                        ) {
                          const groupKey = paramConfig.uiComponent.title
                          if (!groupedParams[groupKey]) {
                            groupedParams[groupKey] = []
                          }
                          groupedParams[groupKey].push(paramConfig)
                        } else {
                          standaloneParams.push(paramConfig)
                        }
                      })

                      const renderedElements: React.ReactNode[] = []

                      // Render grouped checkbox-lists
                      Object.entries(groupedParams).forEach(([groupTitle, params]) => {
                        const firstParam = params[0] as ToolParameterConfig
                        const groupValue = JSON.stringify(
                          params.reduce(
                            (acc, p) => ({ ...acc, [p.id]: tool.params[p.id] === 'true' }),
                            {}
                          )
                        )

                        renderedElements.push(
                          <div
                            key={`group-${groupTitle}`}
                            className='relative min-w-0 space-y-[6px]'
                          >
                            <div className='flex items-center font-medium text-[13px] text-[var(--text-tertiary)]'>
                              {groupTitle}
                            </div>
                            <div className='relative w-full min-w-0'>
                              <CheckboxListSyncWrapper
                                blockId={blockId}
                                paramId={`group-${groupTitle}`}
                                value={groupValue}
                                onChange={(value) => {
                                  try {
                                    const parsed = JSON.parse(value)
                                    params.forEach((param) => {
                                      handleParamChange(
                                        toolIndex,
                                        param.id,
                                        parsed[param.id] ? 'true' : 'false'
                                      )
                                    })
                                  } catch (e) {
                                    // Handle error
                                  }
                                }}
                                uiComponent={firstParam.uiComponent}
                                disabled={disabled}
                              />
                            </div>
                          </div>
                        )
                      })

                      // Render standalone parameters
                      standaloneParams.forEach((param) => {
                        renderedElements.push(
                          <div key={param.id} className='relative min-w-0 space-y-[6px]'>
                            <div className='flex items-center font-medium text-[13px] text-[var(--text-tertiary)]'>
                              {param.uiComponent?.title || formatParameterLabel(param.id)}
                              {param.required && param.visibility === 'user-only' && (
                                <span className='ml-1 text-red-500'>*</span>
                              )}
                              {(!param.required || param.visibility !== 'user-only') && (
                                <span className='ml-1 text-[var(--text-muted)] text-xs'>
                                  (Optional)
                                </span>
                              )}
                            </div>
                            <div className='relative w-full min-w-0'>
                              {param.uiComponent ? (
                                renderParameterInput(
                                  param,
                                  tool.params[param.id] || '',
                                  (value) => handleParamChange(toolIndex, param.id, value),
                                  toolIndex,
                                  tool.params
                                )
                              ) : (
                                <ShortInput
                                  blockId={blockId}
                                  subBlockId={`${subBlockId}-tool-${toolIndex}-${param.id}`}
                                  placeholder={param.description}
                                  password={isPasswordParameter(param.id)}
                                  config={{
                                    id: `${subBlockId}-tool-${toolIndex}-${param.id}`,
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
                        )
                      })

                      return renderedElements
                    })()}
                  </div>
                )}
              </div>
            )
          })}

          {/* Add Tool Button */}
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <div className='flex w-full cursor-pointer items-center justify-center rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F] px-[10px] py-[6px] font-medium text-sm transition-colors hover:bg-[var(--surface-4)]'>
                <div className='flex items-center text-[13px] text-[var(--text-muted)]'>
                  <PlusIcon className='mr-2 h-4 w-4' />
                  Add Tool
                </div>
              </div>
            </PopoverTrigger>
            <PopoverContent
              maxHeight={240}
              className='w-[var(--radix-popover-trigger-width)]'
              align='start'
              sideOffset={6}
            >
              <PopoverSearch placeholder='Search tools...' onValueChange={setSearchQuery} />
              <PopoverScrollArea>
                <ToolCommand.Root filter={customFilter} searchQuery={searchQuery}>
                  <ToolCommand.List>
                    <ToolCommand.Empty>No tools found</ToolCommand.Empty>

                    <ToolCommand.Item
                      value='Create Tool'
                      onSelect={() => {
                        setOpen(false)
                        setCustomToolModalOpen(true)
                      }}
                    >
                      <div className='flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded border border-muted-foreground/50 border-dashed bg-transparent'>
                        <WrenchIcon className='h-[11px] w-[11px] text-muted-foreground' />
                      </div>
                      <span className='truncate'>Create Tool</span>
                    </ToolCommand.Item>

                    <ToolCommand.Item
                      value='Add MCP Server'
                      onSelect={() => {
                        setOpen(false)
                        window.dispatchEvent(
                          new CustomEvent('open-settings', { detail: { tab: 'mcp' } })
                        )
                      }}
                    >
                      <div className='flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded border border-muted-foreground/50 border-dashed bg-transparent'>
                        <Server className='h-[11px] w-[11px] text-muted-foreground' />
                      </div>
                      <span className='truncate'>Add MCP Server</span>
                    </ToolCommand.Item>

                    {/* Display saved custom tools at the top */}
                    {(() => {
                      const matchingCustomTools = customTools.filter(
                        (tool) => customFilter(tool.title, searchQuery || '') > 0
                      )
                      if (matchingCustomTools.length === 0) return null

                      return (
                        <>
                          <PopoverSection>Custom Tools</PopoverSection>
                          {matchingCustomTools.map((customTool) => (
                            <ToolCommand.Item
                              key={customTool.id}
                              value={customTool.title}
                              onSelect={() => {
                                const newTool: StoredTool = {
                                  type: 'custom-tool',
                                  title: customTool.title,
                                  toolId: `custom-${customTool.schema.function.name}`,
                                  params: {},
                                  isExpanded: true,
                                  schema: customTool.schema,
                                  code: customTool.code,
                                  usageControl: 'auto',
                                }

                                setStoreValue([
                                  ...selectedTools.map((tool) => ({
                                    ...tool,
                                    isExpanded: false,
                                  })),
                                  newTool,
                                ])
                                setOpen(false)
                              }}
                            >
                              <div className='flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded bg-blue-500'>
                                <WrenchIcon className='h-[11px] w-[11px] text-white' />
                              </div>
                              <span className='truncate'>{customTool.title}</span>
                            </ToolCommand.Item>
                          ))}
                        </>
                      )
                    })()}

                    {/* Display MCP tools */}
                    <McpToolsList
                      mcpTools={mcpTools}
                      searchQuery={searchQuery || ''}
                      customFilter={customFilter}
                      onToolSelect={(tool) => handleMcpToolSelect(tool, false)}
                      disabled={false}
                    />

                    {/* Display built-in tools */}
                    {(() => {
                      const matchingBlocks = toolBlocks.filter(
                        (block) => customFilter(block.name, searchQuery || '') > 0
                      )
                      if (matchingBlocks.length === 0) return null

                      return (
                        <>
                          <PopoverSection>Built-in Tools</PopoverSection>
                          {matchingBlocks.map((block) => (
                            <ToolCommand.Item
                              key={block.type}
                              value={block.name}
                              onSelect={() => handleSelectTool(block)}
                            >
                              <div
                                className='flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded'
                                style={{ backgroundColor: block.bgColor }}
                              >
                                <IconComponent
                                  icon={block.icon}
                                  className='h-[11px] w-[11px] text-white'
                                />
                              </div>
                              <span className='truncate'>{block.name}</span>
                            </ToolCommand.Item>
                          ))}
                        </>
                      )
                    })()}
                  </ToolCommand.List>
                </ToolCommand.Root>
              </PopoverScrollArea>
            </PopoverContent>
          </Popover>
        </>
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
        blockId={blockId}
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
