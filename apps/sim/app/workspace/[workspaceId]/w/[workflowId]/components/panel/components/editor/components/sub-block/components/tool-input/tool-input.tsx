import type React from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Loader2, WrenchIcon, XIcon } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Badge,
  Combobox,
  type ComboboxOption,
  type ComboboxOptionGroup,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Switch,
  Tooltip,
} from '@/components/emcn'
import { McpIcon, WorkflowIcon } from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'
import {
  getIssueBadgeLabel,
  getIssueBadgeVariant,
  isToolUnavailable,
  getMcpToolIssue as validateMcpTool,
} from '@/lib/mcp/tool-validation'
import type { McpToolSchema } from '@/lib/mcp/types'
import {
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  type OAuthProvider,
  type OAuthService,
} from '@/lib/oauth'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  LongInput,
  ShortInput,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components'
import {
  type CustomTool,
  CustomToolModal,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/components/custom-tool-modal/custom-tool-modal'
import { ToolCredentialSelector } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/components/tools/credential-selector'
import { ParameterWithLabel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/components/tools/parameter'
import { ToolSubBlockRenderer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/components/tools/sub-block-renderer'
import type { StoredTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/types'
import {
  isCustomToolAlreadySelected,
  isMcpToolAlreadySelected,
  isWorkflowAlreadySelected,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WandControlHandlers } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block'
import { getAllBlocks } from '@/blocks'
import type { SubBlockConfig as BlockSubBlockConfig } from '@/blocks/types'
import { useMcpTools } from '@/hooks/mcp/use-mcp-tools'
import {
  type CustomTool as CustomToolDefinition,
  useCustomTools,
} from '@/hooks/queries/custom-tools'
import {
  useForceRefreshMcpTools,
  useMcpServers,
  useMcpToolsEvents,
  useStoredMcpTools,
} from '@/hooks/queries/mcp'
import {
  useChildDeploymentStatus,
  useDeployChildWorkflow,
  useWorkflowState,
  useWorkflows,
} from '@/hooks/queries/workflows'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { getProviderFromModel, supportsToolUsageControl } from '@/providers/utils'
import { useSettingsModalStore } from '@/stores/modals/settings/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import {
  formatParameterLabel,
  getSubBlocksForToolInput,
  getToolParametersConfig,
  isPasswordParameter,
  type SubBlocksForToolInput,
  type ToolParameterConfig,
} from '@/tools/params'
import {
  buildCanonicalIndex,
  buildPreviewContextValues,
  type CanonicalIndex,
  type CanonicalModeOverrides,
  evaluateSubBlockCondition,
  isCanonicalPair,
  resolveCanonicalMode,
  type SubBlockCondition,
} from '@/tools/params-resolver'

const logger = createLogger('ToolInput')

/**
 * Renders the input for workflow_executor's inputMapping parameter.
 * This is a special case that doesn't map to any SubBlockConfig, so it's kept here.
 */
function WorkflowInputMapperInput({
  blockId,
  paramId,
  value,
  onChange,
  disabled,
  workflowId,
}: {
  blockId: string
  paramId: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
  workflowId: string
}) {
  const { data: workflowState, isLoading } = useWorkflowState(workflowId)
  const inputFields = useMemo(
    () => (workflowState?.blocks ? extractInputFieldsFromBlocks(workflowState.blocks) : []),
    [workflowState?.blocks]
  )

  const parsedValue = useMemo(() => {
    try {
      return value ? JSON.parse(value) : {}
    } catch {
      return {}
    }
  }, [value])

  const handleFieldChange = useCallback(
    (fieldName: string, fieldValue: string) => {
      const newValue = { ...parsedValue, [fieldName]: fieldValue }
      onChange(JSON.stringify(newValue))
    },
    [parsedValue, onChange]
  )

  if (!workflowId) {
    return (
      <div className='rounded-md border border-[var(--border-1)] border-dashed bg-[var(--surface-3)] p-4 text-center text-[var(--text-muted)] text-sm'>
        Select a workflow to configure its inputs
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className='flex items-center justify-center rounded-md border border-[var(--border-1)] border-dashed bg-[var(--surface-3)] p-8'>
        <Loader2 className='h-5 w-5 animate-spin text-[var(--text-muted)]' />
      </div>
    )
  }

  if (inputFields.length === 0) {
    return (
      <div className='rounded-md border border-[var(--border-1)] border-dashed bg-[var(--surface-3)] p-4 text-center text-[var(--text-muted)] text-sm'>
        This workflow has no custom input fields
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      {inputFields.map((field: { name: string; type: string }) => (
        <ShortInput
          key={field.name}
          blockId={blockId}
          subBlockId={`${paramId}-${field.name}`}
          placeholder={`Enter ${field.name}${field.type !== 'string' ? ` (${field.type})` : ''}`}
          value={String(parsedValue[field.name] ?? '')}
          onChange={(newValue: string) => handleFieldChange(field.name, newValue)}
          disabled={disabled}
          config={{
            id: `${paramId}-${field.name}`,
            type: 'short-input',
            title: field.name,
          }}
        />
      ))}
    </div>
  )
}

/**
 * Badge component showing deployment status for workflow tools
 */
function WorkflowToolDeployBadge({
  workflowId,
  onDeploySuccess,
}: {
  workflowId: string
  onDeploySuccess?: () => void
}) {
  const { data, isLoading } = useChildDeploymentStatus(workflowId)
  const deployMutation = useDeployChildWorkflow()
  const userPermissions = useUserPermissionsContext()

  const isDeployed = data?.isDeployed ?? null
  const needsRedeploy = data?.needsRedeploy ?? false
  const isDeploying = deployMutation.isPending

  const deployWorkflow = useCallback(() => {
    if (isDeploying || !workflowId || !userPermissions.canAdmin) return

    deployMutation.mutate(
      { workflowId },
      {
        onSuccess: () => {
          onDeploySuccess?.()
        },
      }
    )
  }, [isDeploying, workflowId, userPermissions.canAdmin, deployMutation, onDeploySuccess])

  if (isLoading || (isDeployed && !needsRedeploy)) {
    return null
  }

  if (typeof isDeployed !== 'boolean') {
    return null
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Badge
          variant={!isDeployed ? 'red' : 'amber'}
          className={userPermissions.canAdmin ? 'cursor-pointer' : 'cursor-not-allowed'}
          size='sm'
          dot
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            e.preventDefault()
            if (!isDeploying && userPermissions.canAdmin) {
              deployWorkflow()
            }
          }}
        >
          {isDeploying ? 'Deploying...' : !isDeployed ? 'undeployed' : 'redeploy'}
        </Badge>
      </Tooltip.Trigger>
      <Tooltip.Content>
        <span className='text-sm'>
          {!userPermissions.canAdmin
            ? 'Admin permission required to deploy'
            : !isDeployed
              ? 'Click to deploy'
              : 'Click to redeploy'}
        </span>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

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
 * Resolves a custom tool reference to its full definition.
 *
 * @remarks
 * Custom tools can be stored in two formats:
 * 1. Reference-only (new): `{ customToolId: "...", usageControl: "auto" }` - loads from database
 * 2. Inline (legacy): `{ schema: {...}, code: "..." }` - uses embedded definition
 *
 * @param storedTool - The stored tool reference containing either a customToolId or inline definition
 * @param customToolsList - List of custom tools fetched from the database
 * @returns The resolved custom tool with schema, code, and title, or `null` if not found
 */
function resolveCustomToolFromReference(
  storedTool: StoredTool,
  customToolsList: CustomToolDefinition[]
): { schema: any; code: string; title: string } | null {
  // If the tool has a customToolId (new reference format), look it up
  if (storedTool.customToolId) {
    const customTool = customToolsList.find((t) => t.id === storedTool.customToolId)
    if (customTool) {
      return {
        schema: customTool.schema,
        code: customTool.code,
        title: customTool.title,
      }
    }
    // If not found by ID, fall through to try other methods
    logger.warn(`Custom tool not found by ID: ${storedTool.customToolId}`)
  }

  // Legacy format: inline schema and code
  if (storedTool.schema && storedTool.code !== undefined) {
    return {
      schema: storedTool.schema,
      code: storedTool.code,
      title: storedTool.title || '',
    }
  }

  return null
}

/**
 * Set of built-in tool types that are core platform tools.
 *
 * @remarks
 * These are distinguished from third-party integrations for categorization
 * in the tool selection dropdown.
 */
const BUILT_IN_TOOL_TYPES = new Set([
  'api',
  'file',
  'function',
  'knowledge',
  'search',
  'thinking',
  'image_generator',
  'video_generator',
  'vision',
  'translate',
  'tts',
  'stt',
  'memory',
  'webhook_request',
  'workflow',
])

/**
 * Creates a styled icon element for tool items in the selection dropdown.
 *
 * @param bgColor - Background color for the icon container
 * @param IconComponent - The Lucide icon component to render
 * @returns A styled div containing the icon with consistent dimensions
 */
function createToolIcon(
  bgColor: string,
  IconComponent: React.ComponentType<{ className?: string }>
) {
  return (
    <div
      className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center rounded-[4px]'
      style={{ background: bgColor }}
    >
      <IconComponent className='h-[10px] w-[10px] text-white' />
    </div>
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
export const ToolInput = memo(function ToolInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  allowExpandInPreview,
}: ToolInputProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const workflowId = params.workflowId as string
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)
  const [open, setOpen] = useState(false)
  const [customToolModalOpen, setCustomToolModalOpen] = useState(false)
  const [editingToolIndex, setEditingToolIndex] = useState<number | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [usageControlPopoverIndex, setUsageControlPopoverIndex] = useState<number | null>(null)

  const canonicalModeOverrides = useWorkflowStore(
    useCallback(
      (state) => state.blocks[blockId]?.data?.canonicalModes as CanonicalModeOverrides | undefined,
      [blockId]
    )
  )
  const { collaborativeSetBlockCanonicalMode } = useCollaborativeWorkflow()

  const value = isPreview ? previewValue : storeValue

  const selectedTools: StoredTool[] =
    Array.isArray(value) &&
    value.length > 0 &&
    value[0] !== null &&
    typeof value[0]?.type === 'string'
      ? (value as StoredTool[])
      : []

  const hasReferenceOnlyCustomTools = selectedTools.some(
    (tool) => tool.type === 'custom-tool' && tool.customToolId && !tool.code
  )
  const shouldFetchCustomTools = !isPreview || hasReferenceOnlyCustomTools
  const { data: customTools = [] } = useCustomTools(shouldFetchCustomTools ? workspaceId : '')

  const { mcpTools, isLoading: mcpLoading } = useMcpTools(workspaceId)

  const { data: mcpServers = [], isLoading: mcpServersLoading } = useMcpServers(workspaceId)
  const { data: storedMcpTools = [] } = useStoredMcpTools(workspaceId)
  const forceRefreshMcpTools = useForceRefreshMcpTools()
  useMcpToolsEvents(workspaceId)
  const openSettingsModal = useSettingsModalStore((state) => state.openModal)
  const mcpDataLoading = mcpLoading || mcpServersLoading

  // Fetch workflows for the Workflows section in the dropdown
  const { data: workflowsList = [] } = useWorkflows(workspaceId, { syncRegistry: false })
  const availableWorkflows = useMemo(
    () => workflowsList.filter((w) => w.id !== workflowId),
    [workflowsList, workflowId]
  )
  const hasRefreshedRef = useRef(false)

  const hasMcpTools = selectedTools.some((tool) => tool.type === 'mcp')

  useEffect(() => {
    if (isPreview) return
    if (hasMcpTools && !hasRefreshedRef.current) {
      hasRefreshedRef.current = true
      forceRefreshMcpTools(workspaceId)
    }
  }, [hasMcpTools, forceRefreshMcpTools, workspaceId, isPreview])

  /**
   * Returns issue info for an MCP tool.
   * Uses DB schema (storedMcpTools) when available for real-time updates after refresh,
   * otherwise falls back to Zustand schema (tool.schema) which is always available.
   */
  const getMcpToolIssue = useCallback(
    (tool: StoredTool) => {
      if (tool.type !== 'mcp') return null

      const serverId = tool.params?.serverId as string
      const toolName = tool.params?.toolName as string

      // Try to get fresh schema from DB (enables real-time updates after MCP refresh)
      const storedTool =
        storedMcpTools.find(
          (st) =>
            st.serverId === serverId && st.toolName === toolName && st.workflowId === workflowId
        ) || storedMcpTools.find((st) => st.serverId === serverId && st.toolName === toolName)

      // Use DB schema if available, otherwise use Zustand schema
      const schema = storedTool?.schema ?? (tool.schema as McpToolSchema | undefined)

      return validateMcpTool(
        {
          serverId,
          serverUrl: tool.params?.serverUrl as string | undefined,
          toolName,
          schema,
        },
        mcpServers.map((s) => ({
          id: s.id,
          url: s.url,
          connectionStatus: s.connectionStatus,
          lastError: s.lastError ?? undefined,
        })),
        mcpTools.map((t) => ({
          serverId: t.serverId,
          name: t.name,
          inputSchema: t.inputSchema,
        }))
      )
    },
    [mcpTools, mcpServers, storedMcpTools, workflowId]
  )

  const isMcpToolUnavailable = useCallback(
    (tool: StoredTool): boolean => {
      return isToolUnavailable(getMcpToolIssue(tool))
    },
    [getMcpToolIssue]
  )

  // Filter out MCP tools from unavailable servers for the dropdown
  const availableMcpTools = useMemo(() => {
    return mcpTools.filter((mcpTool) => {
      const server = mcpServers.find((s) => s.id === mcpTool.serverId)
      // Only include tools from connected servers
      return server && server.connectionStatus === 'connected'
    })
  }, [mcpTools, mcpServers])

  const modelValue = useSubBlockStore.getState().getValue(blockId, 'model')
  const model = typeof modelValue === 'string' ? modelValue : ''
  const provider = model ? getProviderFromModel(model) : ''
  const supportsToolControl = provider ? supportsToolUsageControl(provider) : false

  const { filterBlocks, config: permissionConfig } = usePermissionConfig()

  const toolBlocks = useMemo(() => {
    const allToolBlocks = getAllBlocks().filter(
      (block) =>
        !block.hideFromToolbar &&
        (block.category === 'tools' ||
          block.type === 'api' ||
          block.type === 'webhook_request' ||
          block.type === 'workflow' ||
          block.type === 'workflow_input' ||
          block.type === 'knowledge' ||
          block.type === 'function') &&
        block.type !== 'evaluator' &&
        block.type !== 'mcp' &&
        block.type !== 'file'
    )
    return filterBlocks(allToolBlocks)
  }, [filterBlocks])

  const hasBackfilledRef = useRef(false)
  useEffect(() => {
    if (
      isPreview ||
      mcpLoading ||
      mcpTools.length === 0 ||
      selectedTools.length === 0 ||
      hasBackfilledRef.current
    ) {
      return
    }

    // Find MCP tools that need schema or are missing description
    const mcpToolsNeedingUpdate = selectedTools.filter(
      (tool) =>
        tool.type === 'mcp' && tool.params?.toolName && (!tool.schema || !tool.schema.description)
    )

    if (mcpToolsNeedingUpdate.length === 0) {
      return
    }

    const updatedTools = selectedTools.map((tool) => {
      if (tool.type !== 'mcp' || !tool.params?.toolName) {
        return tool
      }

      if (tool.schema?.description) {
        return tool
      }

      const mcpTool = mcpTools.find(
        (mt) => mt.name === tool.params?.toolName && mt.serverId === tool.params?.serverId
      )

      if (mcpTool?.inputSchema) {
        logger.info(`Backfilling schema for MCP tool: ${tool.params.toolName}`)
        return {
          ...tool,
          schema: {
            ...mcpTool.inputSchema,
            description: mcpTool.description,
          },
        }
      }

      return tool
    })

    const hasChanges = updatedTools.some(
      (tool, i) =>
        (tool.schema && !selectedTools[i].schema) ||
        (tool.schema?.description && !selectedTools[i].schema?.description)
    )

    if (hasChanges) {
      hasBackfilledRef.current = true
      logger.info(`Backfilled schemas for ${mcpToolsNeedingUpdate.length} MCP tool(s)`)
      setStoreValue(updatedTools)
    }
  }, [mcpTools, mcpLoading, selectedTools, isPreview, setStoreValue])

  /**
   * Checks if a tool is already selected in the current workflow.
   *
   * @remarks
   * Multi-operation tools, workflow blocks, and knowledge blocks can have
   * multiple instances, so they always return `false`.
   *
   * @param toolId - The tool identifier to check
   * @param blockType - The block type for the tool
   * @returns `true` if tool is already selected (for single-operation tools only)
   */
  const isToolAlreadySelected = (toolId: string, blockType: string) => {
    if (hasMultipleOperations(blockType)) {
      return false
    }
    // Allow multiple instances for workflow and knowledge blocks
    // Each instance can target a different workflow/knowledge base
    if (blockType === 'workflow' || blockType === 'knowledge') {
      return false
    }
    return selectedTools.some((tool) => tool.toolId === toolId)
  }

  /**
   * Checks if a block supports multiple operations.
   *
   * @param blockType - The block type to check
   * @returns `true` if the block has more than one tool operation available
   */
  const hasMultipleOperations = (blockType: string): boolean => {
    const block = getAllBlocks().find((block) => block.type === blockType)
    return (block?.tools?.access?.length || 0) > 1
  }

  /**
   * Gets the available operation options for a multi-operation tool.
   *
   * @remarks
   * First attempts to find options from the block's operation dropdown subBlock,
   * then falls back to creating options from the tools.access array.
   *
   * @param blockType - The block type to get operations for
   * @returns Array of operation options with label and id properties
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
   * Gets the correct tool ID for a given operation.
   *
   * @remarks
   * For single-tool blocks, returns the first tool. For multi-operation blocks,
   * uses the block's tool selection function or matches the operation to a tool ID.
   *
   * @param blockType - The block type
   * @param operation - The selected operation (for multi-operation tools)
   * @returns The tool ID to use for execution, or `undefined` if not found
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

  const handleSelectTool = useCallback(
    (toolBlock: (typeof toolBlocks)[0]) => {
      if (isPreview || disabled) return

      const hasOperations = hasMultipleOperations(toolBlock.type)
      const operationOptions = hasOperations ? getOperationOptions(toolBlock.type) : []
      const defaultOperation = operationOptions.length > 0 ? operationOptions[0].id : undefined

      const toolId = getToolIdForOperation(toolBlock.type, defaultOperation)
      if (!toolId) return

      if (isToolAlreadySelected(toolId, toolBlock.type)) return

      const toolParams = getToolParametersConfig(toolId, toolBlock.type)
      if (!toolParams) return

      const initialParams: Record<string, string> = {}

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
      blockId,
      selectedTools,
      setStoreValue,
    ]
  )

  const handleAddCustomTool = useCallback(
    (customTool: CustomTool) => {
      if (isPreview || disabled) return

      // If the tool has a database ID, store minimal reference
      // Otherwise, store inline for backwards compatibility
      const newTool: StoredTool = customTool.id
        ? {
            type: 'custom-tool',
            customToolId: customTool.id,
            usageControl: 'auto',
            isExpanded: true,
          }
        : {
            type: 'custom-tool',
            title: customTool.title,
            toolId: `custom-${customTool.schema?.function?.name || 'unknown'}`,
            params: {},
            isExpanded: true,
            schema: customTool.schema,
            code: customTool.code || '',
            usageControl: 'auto',
          }

      setStoreValue([...selectedTools.map((tool) => ({ ...tool, isExpanded: false })), newTool])
    },
    [isPreview, disabled, selectedTools, setStoreValue]
  )

  const handleEditCustomTool = useCallback(
    (toolIndex: number) => {
      const tool = selectedTools[toolIndex]
      if (tool.type !== 'custom-tool') return

      // For reference-only tools, we need to resolve the tool from the database
      // The modal will handle loading the full definition
      const resolved = resolveCustomToolFromReference(tool, customTools)
      if (!resolved && !tool.schema) {
        // Tool not found and no inline definition - can't edit
        logger.warn('Cannot edit custom tool - not found in database and no inline definition')
        return
      }

      setEditingToolIndex(toolIndex)
      setCustomToolModalOpen(true)
    },
    [selectedTools, customTools]
  )

  const handleSaveCustomTool = useCallback(
    (customTool: CustomTool) => {
      if (isPreview || disabled) return

      if (editingToolIndex !== null) {
        const existingTool = selectedTools[editingToolIndex]

        // If the tool has a database ID, convert to minimal reference format
        // Otherwise keep inline for backwards compatibility
        const updatedTool: StoredTool = customTool.id
          ? {
              type: 'custom-tool',
              customToolId: customTool.id,
              usageControl: existingTool.usageControl || 'auto',
              isExpanded: existingTool.isExpanded,
            }
          : {
              ...existingTool,
              title: customTool.title,
              schema: customTool.schema,
              code: customTool.code || '',
            }

        setStoreValue(
          selectedTools.map((tool, index) => (index === editingToolIndex ? updatedTool : tool))
        )
        setEditingToolIndex(null)
      } else {
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
      const updatedTools = selectedTools.filter((tool) => {
        if (tool.type !== 'custom-tool') return true

        // New format: check customToolId
        if (tool.customToolId === toolId) {
          return false
        }

        // Legacy format: check by function name match
        if (
          tool.schema?.function?.name &&
          customTools.some(
            (customTool) =>
              customTool.id === toolId &&
              customTool.schema?.function?.name === tool.schema?.function?.name
          )
        ) {
          return false
        }
        return true
      })

      if (updatedTools.length !== selectedTools.length) {
        setStoreValue(updatedTools)
      }
    },
    [selectedTools, customTools, setStoreValue]
  )

  const handleParamChange = useCallback(
    (toolIndex: number, paramId: string, paramValue: string) => {
      if (isPreview || disabled) return

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
        return
      }

      const tool = selectedTools[toolIndex]

      const newToolId = getToolIdForOperation(tool.type, operation)

      if (!newToolId) {
        return
      }

      const toolParams = getToolParametersConfig(newToolId, tool.type)

      if (!toolParams) {
        return
      }

      const newParamIds = new Set(toolParams.userInputParameters.map((p) => p.id))

      const preservedParams: Record<string, string> = {}
      Object.entries(tool.params || {}).forEach(([paramId, value]) => {
        if (newParamIds.has(paramId) && value) {
          preservedParams[paramId] = value
        }
      })

      if (tool.type === 'jira') {
        const subBlockStore = useSubBlockStore.getState()
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
                params: preservedParams,
              }
            : tool
        )
      )
    },
    [isPreview, disabled, selectedTools, getToolIdForOperation, blockId, setStoreValue]
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

  const IconComponent = ({
    icon: Icon,
    className,
  }: {
    icon?: React.ComponentType<{ className?: string }>
    className?: string
  }) => {
    if (!Icon) return null
    return <Icon className={className} />
  }

  const evaluateParameterCondition = (param: ToolParameterConfig, tool: StoredTool): boolean => {
    if (!('uiComponent' in param) || !param.uiComponent?.condition) return true
    const currentValues: Record<string, unknown> = { operation: tool.operation, ...tool.params }
    return evaluateSubBlockCondition(
      param.uiComponent.condition as SubBlockCondition,
      currentValues
    )
  }

  /**
   * Renders a parameter input for custom tools, MCP tools, and legacy registry
   * tools that don't have SubBlockConfig definitions.
   *
   * Registry tools with subBlocks use ToolSubBlockRenderer instead.
   */
  const renderParameterInput = (
    param: ToolParameterConfig,
    value: string,
    onChange: (value: string) => void,
    toolIndex?: number,
    currentToolParams?: Record<string, string>,
    wandControlRef?: React.MutableRefObject<WandControlHandlers | null>
  ) => {
    const uniqueSubBlockId =
      toolIndex !== undefined
        ? `${subBlockId}-tool-${toolIndex}-${param.id}`
        : `${subBlockId}-${param.id}`
    const uiComponent = param.uiComponent

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
          wandControlRef={wandControlRef}
          hideInternalWand={true}
        />
      )
    }

    switch (uiComponent.type) {
      case 'dropdown':
        return (
          <Combobox
            options={
              (uiComponent.options as { id?: string; label: string; value?: string }[] | undefined)
                ?.filter((option) => (option.id ?? option.value) !== '')
                .map((option) => ({
                  label: option.label,
                  value: option.id ?? option.value ?? '',
                })) || []
            }
            value={value}
            onChange={onChange}
            placeholder={uiComponent.placeholder || 'Select option'}
            disabled={disabled}
          />
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
              wandConfig: uiComponent.wandConfig,
            }}
            value={value}
            onChange={onChange}
            wandControlRef={wandControlRef}
            hideInternalWand={true}
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
              wandConfig: uiComponent.wandConfig,
            }}
            value={value}
            onChange={onChange}
            disabled={disabled}
            wandControlRef={wandControlRef}
            hideInternalWand={true}
          />
        )

      case 'oauth-input':
        return (
          <ToolCredentialSelector
            value={value}
            onChange={onChange}
            provider={getProviderIdFromServiceId(uiComponent.serviceId || '') as OAuthProvider}
            serviceId={uiComponent.serviceId as OAuthService}
            disabled={disabled}
            requiredScopes={uiComponent.requiredScopes || []}
          />
        )

      case 'workflow-input-mapper': {
        const selectedWorkflowId = currentToolParams?.workflowId || ''
        return (
          <WorkflowInputMapperInput
            blockId={blockId}
            paramId={param.id}
            value={value}
            onChange={onChange}
            disabled={disabled}
            workflowId={selectedWorkflowId}
          />
        )
      }

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
            wandControlRef={wandControlRef}
            hideInternalWand={true}
          />
        )
    }
  }

  /**
   * Generates grouped options for the tool selection combobox.
   *
   * @remarks
   * Groups tools into categories: Actions (create/add), Custom Tools,
   * MCP Tools, Built-in Tools, and Integrations.
   *
   * @returns Array of option groups for the combobox component
   */
  const toolGroups = useMemo((): ComboboxOptionGroup[] => {
    const groups: ComboboxOptionGroup[] = []

    // Actions group (no section header)
    const actionItems: ComboboxOption[] = []
    if (!permissionConfig.disableCustomTools) {
      actionItems.push({
        label: 'Create Tool',
        value: 'action-create-tool',
        icon: WrenchIcon,
        onSelect: () => {
          setCustomToolModalOpen(true)
          setOpen(false)
        },
        disabled: isPreview,
      })
    }
    if (!permissionConfig.disableMcpTools) {
      actionItems.push({
        label: 'Add MCP Server',
        value: 'action-add-mcp',
        icon: McpIcon,
        onSelect: () => {
          setOpen(false)
          window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'mcp' } }))
        },
        disabled: isPreview,
      })
    }
    if (actionItems.length > 0) {
      groups.push({ items: actionItems })
    }

    // Custom Tools section
    if (!permissionConfig.disableCustomTools && customTools.length > 0) {
      groups.push({
        section: 'Custom Tools',
        items: customTools.map((customTool) => {
          const alreadySelected = isCustomToolAlreadySelected(selectedTools, customTool.id)
          return {
            label: customTool.title,
            value: `custom-${customTool.id}`,
            iconElement: createToolIcon('#3B82F6', WrenchIcon),
            disabled: isPreview || alreadySelected,
            onSelect: () => {
              if (alreadySelected) return
              const newTool: StoredTool = {
                type: 'custom-tool',
                customToolId: customTool.id,
                usageControl: 'auto',
                isExpanded: true,
              }
              setStoreValue([
                ...selectedTools.map((tool) => ({ ...tool, isExpanded: false })),
                newTool,
              ])
              setOpen(false)
            },
          }
        }),
      })
    }

    // MCP Tools section
    if (!permissionConfig.disableMcpTools && availableMcpTools.length > 0) {
      groups.push({
        section: 'MCP Tools',
        items: availableMcpTools.map((mcpTool) => {
          const server = mcpServers.find((s) => s.id === mcpTool.serverId)
          const alreadySelected = isMcpToolAlreadySelected(selectedTools, mcpTool.id)
          return {
            label: mcpTool.name,
            value: `mcp-${mcpTool.id}`,
            iconElement: createToolIcon(mcpTool.bgColor || '#6366F1', mcpTool.icon || McpIcon),
            onSelect: () => {
              if (alreadySelected) return
              const newTool: StoredTool = {
                type: 'mcp',
                title: mcpTool.name,
                toolId: mcpTool.id,
                params: {
                  serverId: mcpTool.serverId,
                  ...(server?.url && { serverUrl: server.url }),
                  toolName: mcpTool.name,
                  serverName: mcpTool.serverName,
                },
                isExpanded: true,
                usageControl: 'auto',
                schema: {
                  ...mcpTool.inputSchema,
                  description: mcpTool.description,
                },
              }
              handleMcpToolSelect(newTool, true)
            },
            disabled: isPreview || disabled || alreadySelected,
          }
        }),
      })
    }

    // Split tool blocks into built-in tools and integrations
    const builtInTools = toolBlocks.filter((block) => BUILT_IN_TOOL_TYPES.has(block.type))
    const integrations = toolBlocks.filter((block) => !BUILT_IN_TOOL_TYPES.has(block.type))

    // Built-in Tools section
    if (builtInTools.length > 0) {
      groups.push({
        section: 'Built-in Tools',
        items: builtInTools.map((block) => {
          const toolId = getToolIdForOperation(block.type, undefined)
          const alreadySelected = toolId ? isToolAlreadySelected(toolId, block.type) : false
          return {
            label: block.name,
            value: `builtin-${block.type}`,
            iconElement: createToolIcon(block.bgColor, block.icon),
            disabled: isPreview || alreadySelected,
            onSelect: () => handleSelectTool(block),
          }
        }),
      })
    }

    // Integrations section
    if (integrations.length > 0) {
      groups.push({
        section: 'Integrations',
        items: integrations.map((block) => {
          const toolId = getToolIdForOperation(block.type, undefined)
          const alreadySelected = toolId ? isToolAlreadySelected(toolId, block.type) : false
          return {
            label: block.name,
            value: `builtin-${block.type}`,
            iconElement: createToolIcon(block.bgColor, block.icon),
            disabled: isPreview || alreadySelected,
            onSelect: () => handleSelectTool(block),
          }
        }),
      })
    }

    // Workflows section - shows available workflows that can be executed as tools
    if (availableWorkflows.length > 0) {
      groups.push({
        section: 'Workflows',
        items: availableWorkflows.map((workflow) => {
          const alreadySelected = isWorkflowAlreadySelected(selectedTools, workflow.id)
          return {
            label: workflow.name,
            value: `workflow-${workflow.id}`,
            iconElement: createToolIcon('#6366F1', WorkflowIcon),
            onSelect: () => {
              if (alreadySelected) return
              const newTool: StoredTool = {
                type: 'workflow_input',
                title: 'Workflow',
                toolId: 'workflow_executor',
                params: {
                  workflowId: workflow.id,
                },
                isExpanded: true,
                usageControl: 'auto',
              }
              setStoreValue([
                ...selectedTools.map((tool) => ({ ...tool, isExpanded: false })),
                newTool,
              ])
              setOpen(false)
            },
            disabled: isPreview || disabled || alreadySelected,
          }
        }),
      })
    }

    return groups
  }, [
    customTools,
    availableMcpTools,
    mcpServers,
    toolBlocks,
    isPreview,
    disabled,
    selectedTools,
    setStoreValue,
    handleMcpToolSelect,
    handleSelectTool,
    permissionConfig.disableCustomTools,
    permissionConfig.disableMcpTools,
    availableWorkflows,
    getToolIdForOperation,
    isToolAlreadySelected,
  ])

  const toolRequiresOAuth = (toolId: string): boolean => {
    const toolParams = getToolParametersConfig(toolId)
    return toolParams?.toolConfig?.oauth?.required || false
  }

  const getToolOAuthConfig = (toolId: string) => {
    const toolParams = getToolParametersConfig(toolId)
    return toolParams?.toolConfig?.oauth
  }

  return (
    <div className='w-full space-y-[8px]'>
      {/* Add Tool Combobox - always at top */}
      <Combobox
        options={[]}
        groups={toolGroups}
        placeholder='Add tool...'
        disabled={disabled}
        searchable
        searchPlaceholder='Search tools...'
        maxHeight={240}
        emptyMessage='No tools found'
        onOpenChange={setOpen}
      />

      {/* Selected Tools List */}
      {selectedTools.length > 0 &&
        selectedTools.map((tool, toolIndex) => {
          // Handle custom tools, MCP tools, and workflow tools differently
          const isCustomTool = tool.type === 'custom-tool'
          const isMcpTool = tool.type === 'mcp'
          const isWorkflowTool = tool.type === 'workflow'
          const toolBlock =
            !isCustomTool && !isMcpTool
              ? toolBlocks.find((block) => block.type === tool.type)
              : null

          // Get the current tool ID (may change based on operation)
          const currentToolId =
            !isCustomTool && !isMcpTool
              ? getToolIdForOperation(tool.type, tool.operation) || tool.toolId || ''
              : tool.toolId || ''

          // Get tool parameters using the new utility with block type for UI components
          const toolParams =
            !isCustomTool && !isMcpTool && currentToolId
              ? getToolParametersConfig(currentToolId, tool.type, {
                  operation: tool.operation,
                  ...tool.params,
                })
              : null

          // Get subblocks for tool-input (primary source for registry tools)
          const subBlocksResult: SubBlocksForToolInput | null =
            !isCustomTool && !isMcpTool && currentToolId
              ? getSubBlocksForToolInput(
                  currentToolId,
                  tool.type,
                  {
                    operation: tool.operation,
                    ...tool.params,
                  },
                  canonicalModeOverrides
                )
              : null

          // Build canonical index for proper dependency resolution
          const toolCanonicalIndex: CanonicalIndex | null = toolBlock?.subBlocks
            ? buildCanonicalIndex(toolBlock.subBlocks)
            : null

          // Build preview context with canonical resolution
          const toolContextValues = toolCanonicalIndex
            ? buildPreviewContextValues(tool.params || {}, {
                blockType: tool.type,
                subBlocks: toolBlock!.subBlocks,
                canonicalIndex: toolCanonicalIndex,
                values: { operation: tool.operation, ...tool.params },
              })
            : tool.params || {}

          // For custom tools, resolve from reference (new format) or use inline (legacy)
          const resolvedCustomTool = isCustomTool
            ? resolveCustomToolFromReference(tool, customTools)
            : null

          // Derive title and schema from resolved tool or inline data
          const customToolTitle = isCustomTool
            ? tool.title || resolvedCustomTool?.title || 'Unknown Tool'
            : null
          const customToolSchema = isCustomTool ? tool.schema || resolvedCustomTool?.schema : null
          const customToolParams =
            isCustomTool && customToolSchema?.function?.parameters?.properties
              ? Object.entries(customToolSchema.function.parameters.properties || {}).map(
                  ([paramId, param]: [string, any]) => ({
                    id: paramId,
                    type: param.type || 'string',
                    description: param.description || '',
                    visibility: (customToolSchema.function.parameters.required?.includes(paramId)
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
          // For registry tools with subBlocks, use the subblock-first approach
          const useSubBlocks = !isCustomTool && !isMcpTool && subBlocksResult?.subBlocks?.length
          const displayParams: ToolParameterConfig[] = isCustomTool
            ? customToolParams
            : isMcpTool
              ? mcpToolParams
              : toolParams?.userInputParameters || []
          const displaySubBlocks: BlockSubBlockConfig[] = useSubBlocks
            ? subBlocksResult!.subBlocks
            : []

          // Check if tool requires OAuth
          const requiresOAuth =
            !isCustomTool && !isMcpTool && currentToolId && toolRequiresOAuth(currentToolId)
          const oauthConfig =
            !isCustomTool && !isMcpTool && currentToolId ? getToolOAuthConfig(currentToolId) : null

          // Determine if tool has expandable body content
          const hasOperations = !isCustomTool && !isMcpTool && hasMultipleOperations(tool.type)
          const hasParams = useSubBlocks
            ? displaySubBlocks.length > 0
            : displayParams.filter((param) => evaluateParameterCondition(param, tool)).length > 0
          const hasToolBody = hasOperations || (requiresOAuth && oauthConfig) || hasParams

          // Only show expansion if tool has body content
          const isExpandedForDisplay = hasToolBody
            ? isPreview
              ? (previewExpanded[toolIndex] ?? !!tool.isExpanded)
              : !!tool.isExpanded
            : false

          return (
            <div
              key={`${tool.customToolId || tool.toolId || toolIndex}-${toolIndex}`}
              className={cn(
                'group relative flex flex-col overflow-hidden rounded-[4px] border border-[var(--border-1)] transition-all duration-200 ease-in-out',
                draggedIndex === toolIndex ? 'scale-95 opacity-40' : '',
                dragOverIndex === toolIndex && draggedIndex !== toolIndex && draggedIndex !== null
                  ? 'translate-y-1 transform border-t-2 border-t-muted-foreground/40'
                  : '',
                selectedTools.length > 1 && !isPreview && !disabled && 'active:cursor-grabbing'
              )}
              draggable={selectedTools.length > 1 && !isPreview && !disabled}
              onDragStart={(e) => handleDragStart(e, toolIndex)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, toolIndex)}
              onDrop={(e) => handleDrop(e, toolIndex)}
            >
              <div
                className={cn(
                  'flex items-center justify-between gap-[8px] rounded-t-[4px] bg-[var(--surface-4)] px-[8px] py-[6.5px]',
                  (isCustomTool || hasToolBody) && 'cursor-pointer'
                )}
                onClick={() => {
                  if (isCustomTool) {
                    handleEditCustomTool(toolIndex)
                  } else if (hasToolBody) {
                    toggleToolExpansion(toolIndex)
                  }
                }}
              >
                <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
                  <div
                    className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center rounded-[4px]'
                    style={{
                      backgroundColor: isCustomTool
                        ? '#3B82F6'
                        : isMcpTool
                          ? mcpTool?.bgColor || '#6366F1'
                          : isWorkflowTool
                            ? '#6366F1'
                            : toolBlock?.bgColor,
                    }}
                  >
                    {isCustomTool ? (
                      <WrenchIcon className='h-[10px] w-[10px] text-white' />
                    ) : isMcpTool ? (
                      <IconComponent icon={McpIcon} className='h-[10px] w-[10px] text-white' />
                    ) : isWorkflowTool ? (
                      <IconComponent icon={WorkflowIcon} className='h-[10px] w-[10px] text-white' />
                    ) : (
                      <IconComponent
                        icon={toolBlock?.icon}
                        className='h-[10px] w-[10px] text-white'
                      />
                    )}
                  </div>
                  <span className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                    {isCustomTool ? customToolTitle : tool.title}
                  </span>
                  {isMcpTool &&
                    !mcpDataLoading &&
                    (() => {
                      const issue = getMcpToolIssue(tool)
                      if (!issue) return null
                      const serverId = tool.params?.serverId
                      return (
                        <Tooltip.Root>
                          <Tooltip.Trigger asChild>
                            <Badge
                              variant={getIssueBadgeVariant(issue)}
                              className='cursor-pointer'
                              size='sm'
                              dot
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation()
                                e.preventDefault()
                                openSettingsModal({ section: 'mcp', mcpServerId: serverId })
                              }}
                            >
                              {getIssueBadgeLabel(issue)}
                            </Badge>
                          </Tooltip.Trigger>
                          <Tooltip.Content>
                            <span className='text-sm'>{issue.message}: click to open settings</span>
                          </Tooltip.Content>
                        </Tooltip.Root>
                      )
                    })()}
                  {(tool.type === 'workflow' || tool.type === 'workflow_input') &&
                    tool.params?.workflowId && (
                      <WorkflowToolDeployBadge workflowId={tool.params.workflowId} />
                    )}
                </div>
                <div className='flex flex-shrink-0 items-center gap-[8px]'>
                  {supportsToolControl && !(isMcpTool && isMcpToolUnavailable(tool)) && (
                    <Popover
                      open={usageControlPopoverIndex === toolIndex}
                      onOpenChange={(open) => setUsageControlPopoverIndex(open ? toolIndex : null)}
                    >
                      <PopoverTrigger asChild>
                        <button
                          className='flex items-center justify-center font-medium text-[12px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]'
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                          aria-label='Tool usage control'
                        >
                          {tool.usageControl === 'auto' && 'Auto'}
                          {tool.usageControl === 'force' && 'Force'}
                          {tool.usageControl === 'none' && 'None'}
                          {!tool.usageControl && 'Auto'}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        side='bottom'
                        align='end'
                        sideOffset={8}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        className='gap-[2px]'
                        border
                      >
                        <PopoverItem
                          active={(tool.usageControl || 'auto') === 'auto'}
                          onClick={() => {
                            handleUsageControlChange(toolIndex, 'auto')
                            setUsageControlPopoverIndex(null)
                          }}
                        >
                          Auto <span className='text-[var(--text-tertiary)]'>(model decides)</span>
                        </PopoverItem>
                        <PopoverItem
                          active={tool.usageControl === 'force'}
                          onClick={() => {
                            handleUsageControlChange(toolIndex, 'force')
                            setUsageControlPopoverIndex(null)
                          }}
                        >
                          Force <span className='text-[var(--text-tertiary)]'>(always use)</span>
                        </PopoverItem>
                        <PopoverItem
                          active={tool.usageControl === 'none'}
                          onClick={() => {
                            handleUsageControlChange(toolIndex, 'none')
                            setUsageControlPopoverIndex(null)
                          }}
                        >
                          None
                        </PopoverItem>
                      </PopoverContent>
                    </Popover>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemoveTool(toolIndex)
                    }}
                    className='flex items-center justify-center text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]'
                    aria-label='Remove tool'
                  >
                    <XIcon className='h-[13px] w-[13px]' />
                  </button>
                </div>
              </div>

              {!isCustomTool && isExpandedForDisplay && (
                <div className='flex flex-col gap-[10px] overflow-visible rounded-b-[4px] border-[var(--border-1)] border-t bg-[var(--surface-2)] px-[8px] py-[8px]'>
                  {/* Operation dropdown for tools with multiple operations */}
                  {(() => {
                    const hasOperations = hasMultipleOperations(tool.type)
                    const operationOptions = hasOperations ? getOperationOptions(tool.type) : []

                    return hasOperations && operationOptions.length > 0 ? (
                      <div className='relative space-y-[6px]'>
                        <div className='font-medium text-[13px] text-[var(--text-primary)]'>
                          Operation
                        </div>
                        <Combobox
                          options={operationOptions
                            .filter((option) => option.id !== '')
                            .map((option) => ({
                              label: option.label,
                              value: option.id,
                            }))}
                          value={tool.operation || operationOptions[0].id}
                          onChange={(value) => handleOperationChange(toolIndex, value)}
                          placeholder='Select operation'
                          disabled={disabled}
                        />
                      </div>
                    ) : null
                  })()}

                  {/* OAuth credential selector if required */}
                  {requiresOAuth && oauthConfig && (
                    <div className='relative min-w-0 space-y-[6px]'>
                      <div className='font-medium text-[13px] text-[var(--text-primary)]'>
                        Account
                      </div>
                      <div className='w-full min-w-0'>
                        <ToolCredentialSelector
                          value={tool.params?.credential || ''}
                          onChange={(value: string) =>
                            handleParamChange(toolIndex, 'credential', value)
                          }
                          provider={oauthConfig.provider as OAuthProvider}
                          requiredScopes={
                            toolBlock?.subBlocks?.find((sb) => sb.id === 'credential')
                              ?.requiredScopes ||
                            getCanonicalScopesForProvider(oauthConfig.provider)
                          }
                          label={`Select ${oauthConfig.provider} account`}
                          serviceId={oauthConfig.provider}
                          disabled={disabled}
                        />
                      </div>
                    </div>
                  )}

                  {/* Tool parameters */}
                  {(() => {
                    // SubBlock-first rendering for registry tools
                    if (useSubBlocks && displaySubBlocks.length > 0) {
                      return displaySubBlocks.map((sb) => {
                        const effectiveParamId = sb.canonicalParamId || sb.id

                        // Compute canonical toggle for basic/advanced mode switching
                        const canonicalId = toolCanonicalIndex?.canonicalIdBySubBlockId[sb.id]
                        const canonicalGroup = canonicalId
                          ? toolCanonicalIndex?.groupsById[canonicalId]
                          : undefined
                        const hasCanonicalPair = isCanonicalPair(canonicalGroup)
                        const canonicalMode =
                          canonicalGroup && hasCanonicalPair
                            ? resolveCanonicalMode(
                                canonicalGroup,
                                { operation: tool.operation, ...tool.params },
                                canonicalModeOverrides
                              )
                            : undefined

                        const canonicalToggleProp =
                          hasCanonicalPair && canonicalMode && canonicalId
                            ? {
                                mode: canonicalMode,
                                onToggle: () => {
                                  const nextMode =
                                    canonicalMode === 'advanced' ? 'basic' : 'advanced'
                                  collaborativeSetBlockCanonicalMode(blockId, canonicalId, nextMode)
                                },
                              }
                            : undefined

                        // Ensure title is present for SubBlock's label rendering
                        const sbWithTitle = sb.title
                          ? sb
                          : { ...sb, title: formatParameterLabel(effectiveParamId) }

                        return (
                          <ToolSubBlockRenderer
                            key={sb.id}
                            blockId={blockId}
                            subBlockId={subBlockId}
                            toolIndex={toolIndex}
                            subBlock={sbWithTitle}
                            effectiveParamId={effectiveParamId}
                            toolParams={tool.params}
                            onParamChange={handleParamChange}
                            disabled={disabled}
                            canonicalToggle={canonicalToggleProp}
                          />
                        )
                      })
                    }

                    // Fallback: legacy ToolParameterConfig-based rendering
                    // Used for custom tools, MCP tools, and registry tools without subBlocks
                    const filteredParams = displayParams.filter((param) =>
                      evaluateParameterCondition(param, tool)
                    )

                    const renderedElements: React.ReactNode[] = []

                    filteredParams.forEach((param) => {
                      renderedElements.push(
                        <ParameterWithLabel
                          key={param.id}
                          paramId={param.id}
                          title={param.uiComponent?.title || formatParameterLabel(param.id)}
                          isRequired={param.required === true}
                          visibility={param.visibility || 'user-or-llm'}
                          wandConfig={param.uiComponent?.wandConfig}
                          disabled={disabled}
                          isPreview={isPreview || false}
                        >
                          {(wandControlRef: React.MutableRefObject<WandControlHandlers | null>) =>
                            renderParameterInput(
                              param,
                              tool.params?.[param.id] || '',
                              (value) => handleParamChange(toolIndex, param.id, value),
                              toolIndex,
                              toolContextValues as Record<string, string>,
                              wandControlRef
                            )
                          }
                        </ParameterWithLabel>
                      )
                    })

                    return renderedElements
                  })()}
                </div>
              )}
            </div>
          )
        })}

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
            ? (() => {
                const storedTool = selectedTools[editingToolIndex]
                // Resolve the full tool definition from reference or inline
                const resolved = resolveCustomToolFromReference(storedTool, customTools)

                if (resolved) {
                  // Find the database ID
                  const dbTool = storedTool.customToolId
                    ? customTools.find((t) => t.id === storedTool.customToolId)
                    : customTools.find(
                        (t) => t.schema?.function?.name === resolved.schema?.function?.name
                      )

                  return {
                    id: dbTool?.id,
                    schema: resolved.schema,
                    code: resolved.code,
                  }
                }

                // Fallback to inline definition (legacy format)
                return {
                  id: customTools.find(
                    (tool) => tool.schema?.function?.name === storedTool.schema?.function?.name
                  )?.id,
                  schema: storedTool.schema,
                  code: storedTool.code || '',
                }
              })()
            : undefined
        }
      />
    </div>
  )
})
