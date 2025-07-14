import { useCallback, useEffect, useState } from 'react'
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
import { Switch } from '@/components/ui/switch'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { OAuthProvider, OAuthService } from '@/lib/oauth/oauth'
import { cn } from '@/lib/utils'
import { getAllBlocks } from '@/blocks'
import { getProviderFromModel, supportsToolUsageControl } from '@/providers/utils'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import {
  formatParameterLabel,
  getToolParametersConfig,
  isPasswordParameter,
  type ToolParameterConfig,
} from '@/tools/params'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'
import { ChannelSelectorInput } from '../channel-selector/channel-selector-input'
import { CheckboxList } from '../checkbox-list'
import { Code } from '../code'
import { ComboBox } from '../combobox'
import { DateInput } from '../date-input'
import { FileSelectorInput } from '../file-selector/file-selector-input'
import { FileUpload } from '../file-upload'
import { LongInput } from '../long-input'
import { ProjectSelectorInput } from '../project-selector/project-selector-input'
import { ShortInput } from '../short-input'
import { SliderInput } from '../slider-input'
import { Table } from '../table'
import { TimeInput } from '../time-input'
import { type CustomTool, CustomToolModal } from './components/custom-tool-modal/custom-tool-modal'
import { ToolCommand } from './components/tool-command/tool-command'
import { ToolCredentialSelector } from './components/tool-credential-selector'

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
  toolId: string // Direct tool ID instead of relying on block mapping
  params: Record<string, string>
  isExpanded?: boolean
  schema?: any // For custom tools
  code?: string // For custom tools implementation
  operation?: string // For tools with multiple operations
  usageControl?: 'auto' | 'force' | 'none'
}

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
        }}
        disabled={disabled}
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

function DateInputSyncWrapper({
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
      <DateInput
        blockId={blockId}
        subBlockId={paramId}
        placeholder={uiComponent.placeholder}
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
        isConnecting={false}
        language={uiComponent.language}
        generationType={uiComponent.generationType}
        disabled={disabled}
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
        isConnecting={false}
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
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
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

  // Check if a tool is already selected (allowing multiple instances for multi-operation tools)
  const isToolAlreadySelected = (toolId: string, blockType: string) => {
    // For tools with multiple operations, allow multiple instances
    if (hasMultipleOperations(blockType)) {
      return false
    }
    // For single-operation tools, prevent duplicates
    return selectedTools.some((tool) => tool.toolId === toolId)
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
      const toolParams = getToolParametersConfig(toolId)
      return {
        id: toolId,
        label: toolParams?.toolConfig?.name || toolId,
      }
    })
  }

  // Get the correct tool ID based on operation
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
        console.error('Error selecting tool for operation:', error)
      }
    }

    // If there's an operation that matches a tool ID, use it
    if (operation && block.tools.access.includes(operation)) {
      return operation
    }

    // Default to first tool
    return block.tools.access[0]
  }

  // Initialize tool parameters with auto-fill if enabled
  const initializeToolParams = (
    toolId: string,
    params: ToolParameterConfig[],
    instanceId?: string
  ): Record<string, string> => {
    const initialParams: Record<string, string> = {}

    // Only auto-fill parameters if the setting is enabled
    if (isAutoFillEnvVarsEnabled) {
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

  const handleSelectTool = (toolBlock: (typeof toolBlocks)[0]) => {
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
    if (isWide) {
      setStoreValue([
        ...selectedTools.map((tool, index) => ({
          ...tool,
          isExpanded: Math.floor(selectedTools.length / 2) === Math.floor(index / 2),
        })),
        newTool,
      ])
    } else {
      setStoreValue([...selectedTools.map((tool) => ({ ...tool, isExpanded: false })), newTool])
    }

    setOpen(false)
  }

  const handleAddCustomTool = (customTool: CustomTool) => {
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
    if (isWide) {
      setStoreValue([
        ...selectedTools.map((tool, index) => ({
          ...tool,
          isExpanded: Math.floor(selectedTools.length / 2) === Math.floor(index / 2),
        })),
        newTool,
      ])
    } else {
      setStoreValue([...selectedTools.map((tool) => ({ ...tool, isExpanded: false })), newTool])
    }
  }

  const handleEditCustomTool = (toolIndex: number) => {
    const tool = selectedTools[toolIndex]
    if (tool.type !== 'custom-tool' || !tool.schema) return

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

  const handleRemoveTool = (toolIndex: number) => {
    if (isPreview || disabled) return
    setStoreValue(selectedTools.filter((_, index) => index !== toolIndex))
  }

  const handleDeleteTool = (toolId: string) => {
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
  }

  const handleParamChange = (toolIndex: number, paramId: string, paramValue: string) => {
    if (isPreview || disabled) return

    const tool = selectedTools[toolIndex]

    // Store the value in the tool params store for future use
    if (paramValue.trim()) {
      subBlockStore.setToolParam(tool.toolId, paramId, paramValue)
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
    console.log('🔄 handleOperationChange called:', { toolIndex, operation, isPreview, disabled })

    if (isPreview || disabled) {
      console.log('❌ Early return: preview or disabled')
      return
    }

    const tool = selectedTools[toolIndex]
    console.log('🔧 Current tool:', tool)

    const newToolId = getToolIdForOperation(tool.type, operation)
    console.log('🆔 getToolIdForOperation result:', { toolType: tool.type, operation, newToolId })

    if (!newToolId) {
      console.log('❌ Early return: no newToolId')
      return
    }

    // Get parameters for the new tool
    const toolParams = getToolParametersConfig(newToolId, tool.type)
    console.log('📋 getToolParametersConfig result:', {
      newToolId,
      toolType: tool.type,
      toolParams,
    })

    if (!toolParams) {
      console.log('❌ Early return: no toolParams')
      return
    }

    // Initialize parameters for the new operation
    const initialParams = initializeToolParams(newToolId, toolParams.userInputParameters, blockId)

    // Clear fields when operation changes for Jira
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
              params: initialParams, // Reset params when operation changes
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

  // Evaluate parameter conditions to determine if parameter should be shown
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

  // Helper function to get credential for channel selector
  const getCredentialForChannelSelector = (paramId: string): string => {
    // Look for the tool that contains this parameter
    const currentToolIndex = selectedTools.findIndex((tool) => {
      const toolParams = getToolParametersConfig(tool.toolId)
      return toolParams?.userInputParameters.some((p) => p.id === paramId)
    })

    if (currentToolIndex === -1) return ''

    const currentTool = selectedTools[currentToolIndex]

    // Enhanced credential detection logic from legacy implementation
    // Check for bot token first, then OAuth credential
    const botToken =
      currentTool.params.botToken || (subBlockStore.getValue(blockId, 'botToken') as string)
    const oauthCredential =
      currentTool.params.credential || (subBlockStore.getValue(blockId, 'credential') as string)

    if (botToken?.trim()) {
      return botToken
    }
    if (oauthCredential?.trim()) {
      return oauthCredential
    }

    // Fallback: check for other common credential parameter names
    const credentialKeys = ['accessToken', 'token', 'apiKey', 'authToken']
    for (const key of credentialKeys) {
      const value = currentTool.params[key] || (subBlockStore.getValue(blockId, key) as string)
      if (value?.trim()) {
        return value
      }
    }

    return ''
  }

  // Render the appropriate UI component based on parameter configuration
  const renderParameterInput = (
    param: ToolParameterConfig,
    value: string,
    onChange: (value: string) => void,
    toolIndex?: number
  ) => {
    // Create unique blockId for tool parameters to avoid conflicts with main block
    const uniqueBlockId = toolIndex !== undefined ? `${blockId}-tool-${toolIndex}` : blockId
    const uiComponent = param.uiComponent

    // If no UI component info, fall back to basic input
    if (!uiComponent) {
      return (
        <ShortInput
          blockId={uniqueBlockId}
          subBlockId={`${subBlockId}-param`}
          placeholder={param.description}
          password={isPasswordParameter(param.id)}
          isConnecting={false}
          config={{
            id: `${subBlockId}-param`,
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
            <SelectTrigger className='w-full text-left'>
              <SelectValue
                placeholder={uiComponent.placeholder || 'Select option'}
                className='truncate'
              />
            </SelectTrigger>
            <SelectContent>
              {uiComponent.options?.map((option: any) => (
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
            blockId={uniqueBlockId}
            subBlockId={`${subBlockId}-param`}
            placeholder={uiComponent.placeholder || param.description}
            isConnecting={false}
            config={{
              id: `${subBlockId}-param`,
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
            blockId={uniqueBlockId}
            subBlockId={`${subBlockId}-param`}
            placeholder={uiComponent.placeholder || param.description}
            password={uiComponent.password || isPasswordParameter(param.id)}
            isConnecting={false}
            config={{
              id: `${subBlockId}-param`,
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
          <ChannelSelectorInput
            blockId={uniqueBlockId}
            subBlock={{
              id: param.id,
              type: 'channel-selector' as const,
              title: param.id,
              provider: uiComponent.provider || 'slack',
              placeholder: uiComponent.placeholder,
            }}
            onChannelSelect={onChange}
            credential={getCredentialForChannelSelector(param.id)}
            disabled={disabled}
          />
        )

      case 'project-selector':
        return (
          <ProjectSelectorInput
            blockId={uniqueBlockId}
            subBlock={{
              id: param.id,
              type: 'project-selector' as const,
              title: param.id,
              provider: uiComponent.provider || 'jira',
              serviceId: uiComponent.serviceId,
              placeholder: uiComponent.placeholder,
              requiredScopes: uiComponent.requiredScopes,
            }}
            onProjectSelect={onChange}
            disabled={disabled}
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
            blockId={uniqueBlockId}
            paramId={param.id}
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

      case 'date-input':
        return (
          <DateInputSyncWrapper
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
            subBlockId={`${subBlockId}-param`}
            placeholder={uiComponent.placeholder || param.description}
            password={uiComponent.password || isPasswordParameter(param.id)}
            isConnecting={false}
            config={{
              id: `${subBlockId}-param`,
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
                                toolId: `custom-${customTool.schema.function.name}`,
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

            // Get the current tool ID (may change based on operation)
            const currentToolId = !isCustomTool
              ? getToolIdForOperation(tool.type, tool.operation) || tool.toolId
              : tool.toolId

            // Get tool parameters using the new utility with block type for UI components
            const toolParams = !isCustomTool
              ? getToolParametersConfig(currentToolId, tool.type)
              : null

            // For custom tools, extract parameters from schema
            const customToolParams =
              isCustomTool && tool.schema
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

            // Get all parameters to display
            const displayParams = isCustomTool
              ? customToolParams
              : toolParams?.userInputParameters || []

            // Check if tool requires OAuth
            const requiresOAuth = !isCustomTool && toolRequiresOAuth(currentToolId)
            const oauthConfig = !isCustomTool ? getToolOAuthConfig(currentToolId) : null

            // Check if the tool has any expandable content
            const hasExpandableContent = isCustomTool || displayParams.length > 0 || requiresOAuth

            return (
              <div
                key={`${tool.toolId}-${toolIndex}`}
                className={cn(
                  'group relative flex flex-col transition-all duration-200 ease-in-out',
                  isWide ? 'w-[calc(50%-0.25rem)]' : 'w-full',
                  draggedIndex === toolIndex ? 'scale-95 opacity-40' : '',
                  dragOverIndex === toolIndex && draggedIndex !== toolIndex && draggedIndex !== null
                    ? 'translate-y-1 transform'
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
                    'flex flex-col overflow-visible rounded-md border bg-card',
                    dragOverIndex === toolIndex &&
                      draggedIndex !== toolIndex &&
                      draggedIndex !== null
                      ? 'border-t-2 border-t-muted-foreground/40'
                      : ''
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center justify-between bg-accent/50 p-2',
                      hasExpandableContent ? 'cursor-pointer' : 'cursor-default'
                    )}
                    onClick={() => {
                      if (isCustomTool) {
                        handleEditCustomTool(toolIndex)
                      } else if (hasExpandableContent) {
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
                          handleRemoveTool(toolIndex)
                        }}
                        className='text-muted-foreground hover:text-foreground'
                      >
                        <XIcon className='h-4 w-4' />
                      </button>
                    </div>
                  </div>

                  {!isCustomTool && hasExpandableContent && tool.isExpanded && (
                    <div className='space-y-3 overflow-visible p-3'>
                      {/* Operation dropdown for tools with multiple operations */}
                      {(() => {
                        const hasOperations = hasMultipleOperations(tool.type)
                        const operationOptions = hasOperations ? getOperationOptions(tool.type) : []

                        return hasOperations && operationOptions.length > 0 ? (
                          <div className='relative min-w-0 space-y-1.5'>
                            <div className='font-medium text-muted-foreground text-xs'>
                              Operation
                            </div>
                            <div className='w-full min-w-0'>
                              <Select
                                value={tool.operation || operationOptions[0].id}
                                onValueChange={(value) => handleOperationChange(toolIndex, value)}
                              >
                                <SelectTrigger className='w-full min-w-0 text-left'>
                                  <SelectValue
                                    placeholder='Select operation'
                                    className='truncate'
                                  />
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
                          </div>
                        ) : null
                      })()}

                      {/* OAuth credential selector if required */}
                      {requiresOAuth && oauthConfig && (
                        <div className='relative min-w-0 space-y-1.5'>
                          <div className='font-medium text-muted-foreground text-xs'>Account</div>
                          <div className='w-full min-w-0'>
                            <ToolCredentialSelector
                              value={tool.params.credential || ''}
                              onChange={(value) =>
                                handleParamChange(toolIndex, 'credential', value)
                              }
                              provider={oauthConfig.provider as OAuthProvider}
                              requiredScopes={oauthConfig.additionalScopes || []}
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
                              className='relative min-w-0 space-y-1.5'
                            >
                              <div className='flex items-center font-medium text-muted-foreground text-xs'>
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
                            <div key={param.id} className='relative min-w-0 space-y-1.5'>
                              <div className='flex items-center font-medium text-muted-foreground text-xs'>
                                {param.uiComponent?.title || formatParameterLabel(param.id)}
                                {param.required && param.visibility === 'user-only' && (
                                  <span className='ml-1 text-red-500'>*</span>
                                )}
                                {!param.required && (
                                  <span className='ml-1 text-muted-foreground/60 text-xs'>
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
                                    toolIndex
                                  )
                                ) : (
                                  <ShortInput
                                    blockId={`${blockId}-tool-${toolIndex}`}
                                    subBlockId={`${subBlockId}-param`}
                                    placeholder={param.description}
                                    password={isPasswordParameter(param.id)}
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
                          )
                        })

                        return renderedElements
                      })()}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Drop zone for the end of the list */}
          {selectedTools.length > 0 && draggedIndex !== null && (
            <div
              className={cn(
                'h-2 w-full rounded transition-all duration-200 ease-in-out',
                dragOverIndex === selectedTools.length
                  ? 'border-b-2 border-b-muted-foreground/40'
                  : ''
              )}
              onDragOver={(e) => handleDragOver(e, selectedTools.length)}
              onDrop={(e) => handleDrop(e, selectedTools.length)}
            />
          )}

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
                                  toolId: `custom-${customTool.schema.function.name}`,
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
