import type React from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Combobox,
  type ComboboxOption,
  type ComboboxOptionGroup,
  cn,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Tooltip,
} from '@sim/emcn'
import { ArrowLeft, ChevronRight, Server, Wrench, X } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { McpIcon, WorkflowIcon } from '@/components/icons'
import { getManagedMcpConnectorIcon } from '@/lib/credential-groups/managed-mcp-connector-icons'
import { MCP_SERVER_ADVANCED_TOOL_TYPE } from '@/lib/mcp/shared'
import {
  getIssueBadgeLabel,
  getIssueBadgeVariant,
  isToolUnavailable,
  getMcpToolIssue as validateMcpTool,
} from '@/lib/mcp/tool-validation'
import type { McpToolSchema } from '@/lib/mcp/types'
import {
  NO_DENIED_OPERATIONS,
  OPERATION_SUBBLOCK_ID,
} from '@/lib/permission-groups/operation-access'
import { resolveStoredToolName } from '@/lib/workflows/subblocks/display'
import { buildToolSubBlockId } from '@/lib/workflows/tool-input/synthetic-subblocks'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { McpServerFormModal } from '@/app/workspace/[workspaceId]/settings/components/mcp/components/mcp-server-form-modal/mcp-server-form-modal'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import {
  type CustomTool,
  CustomToolModal,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/components/custom-tool-modal/custom-tool-modal'
import { ToolSubBlockRenderer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/components/tools/sub-block-renderer'
import { clearDependentToolParams } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/param-dependents'
import type { StoredTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/types'
import {
  isAgentToolBlock,
  isCustomToolAlreadySelected,
  isMcpToolAlreadySelected,
  isWorkflowAlreadySelected,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/utils'
import { getActiveWorkflowSearchHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import {
  ActiveSearchTargetProvider,
  useActiveSearchTarget,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import { getAllBlocks, getBlock } from '@/blocks'
import { isCustomBlockType } from '@/blocks/custom/build-config'
import { useCustomBlockOverlayVersion } from '@/blocks/custom/client-overlay'
import { getTileIconColorClass } from '@/blocks/icon-color'
import type { BlockConfig, SubBlockConfig as BlockSubBlockConfig } from '@/blocks/types'
import { BUILT_IN_TOOL_TYPES } from '@/blocks/utils'
import { useMcpOauthPopup } from '@/hooks/mcp/use-mcp-oauth-popup'
import { useMcpTools } from '@/hooks/mcp/use-mcp-tools'
import { useWorkspaceCredential } from '@/hooks/queries/credentials'
import {
  type CustomTool as CustomToolDefinition,
  useCustomTools,
} from '@/hooks/queries/custom-tools'
import { useDeploymentInfo, useDeployWorkflow } from '@/hooks/queries/deployments'
import {
  useAllowedMcpDomains,
  useCreateMcpServer,
  useForceRefreshMcpTools,
  useMcpToolServers,
  useStoredMcpTools,
} from '@/hooks/queries/mcp'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useAvailableEnvVarKeys } from '@/hooks/use-available-env-vars'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useOperationAccess } from '@/hooks/use-operation-access'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { getProviderFromModel, supportsToolUsageControl } from '@/providers/utils'
import type { ActiveSearchTarget } from '@/stores/panel/editor/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { getToolMetadata } from '@/tools/metadata'
import { buildSubBlocksFromJsonSchema, encodeToolParamValue } from '@/tools/param-shape'
import {
  formatParameterLabel,
  getSubBlocksForToolInput,
  getToolIdForOperation,
  isUserFacingToolParam,
  type SubBlocksForToolInput,
} from '@/tools/params'
import {
  buildCanonicalIndex,
  type CanonicalIndex,
  type CanonicalModeOverrides,
  isCanonicalPair,
  reindexToolCanonicalModes,
  resolveCanonicalMode,
  resolveDependencyValue,
  scopeCanonicalModesForTool,
} from '@/tools/params-resolver'

const logger = createLogger('ToolInput')

const ADVANCED_MCP_SERVER_TOOL_SCHEMA: McpToolSchema = {
  type: 'object',
  properties: {
    serverId: {
      type: 'string',
      description: 'Canonical workspace MCP server ID',
    },
  },
  required: ['serverId'],
}

function WorkflowToolDeployBadge({
  workflowId,
  onDeploySuccess,
}: {
  workflowId: string
  onDeploySuccess?: () => void
}) {
  const { data, isLoading } = useDeploymentInfo(workflowId)
  const { mutate, isPending: isDeploying } = useDeployWorkflow()
  const userPermissions = useUserPermissionsContext()

  const isDeployed = data?.isDeployed ?? null
  const needsRedeploy = data?.needsRedeployment ?? false

  const deployWorkflow = useCallback(() => {
    if (isDeploying || !workflowId || !userPermissions.canAdmin) return

    mutate(
      { workflowId },
      {
        onSuccess: () => {
          onDeploySuccess?.()
        },
      }
    )
  }, [isDeploying, workflowId, userPermissions.canAdmin, mutate, onDeploySuccess])

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

/**
 * Checks if a block supports multiple operations.
 *
 * @param block - The block config to check
 * @returns `true` if the block has more than one tool operation available
 */
function hasMultipleOperations(block: BlockConfig | undefined): boolean {
  return (block?.tools?.access?.length || 0) > 1
}

/**
 * Gets the available operation options for a multi-operation tool.
 *
 * @param block - The block config to get operations for
 * @returns Array of operation options with label and id properties
 */
function getOperationOptions(block: BlockConfig | undefined): { label: string; id: string }[] {
  if (!block || !block.tools?.access) return []

  const operationSubBlock = block.subBlocks.find((sb) => sb.id === OPERATION_SUBBLOCK_ID)
  if (
    operationSubBlock &&
    operationSubBlock.type === 'dropdown' &&
    Array.isArray(operationSubBlock.options)
  ) {
    return operationSubBlock.options as { label: string; id: string }[]
  }

  return block.tools.access.map((toolId) => {
    try {
      return {
        id: toolId,
        label: getToolMetadata(toolId)?.name || toolId,
      }
    } catch (error) {
      logger.error(`Error getting tool config for ${toolId}:`, error)
      return { id: toolId, label: toolId }
    }
  })
}

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
      className='flex size-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-sm [&_img]:size-full'
      style={{ background: bgColor }}
    >
      <IconComponent className={cn('size-[10px]', getTileIconColorClass(bgColor))} />
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

function IconComponent({
  icon: Icon,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>
  className?: string
}) {
  if (!Icon) return null
  return <Icon className={className} />
}

const UNSUPPORTED_CUSTOM_TOOL_MESSAGE = 'Custom tools are not supported by this block yet'
const UNSUPPORTED_MCP_TOOL_MESSAGE = 'MCP tools are not supported by this block yet'

/**
 * Trailing "Unavailable" affordance for a tool category the consuming block
 * cannot execute. Rendered as the combobox item's suffix so the greyed-out row
 * still surfaces a tooltip explaining why on hover.
 */
function UnsupportedToolBadge({ message }: { message: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className='text-[var(--text-tertiary)] text-xs'>Unavailable</span>
      </Tooltip.Trigger>
      <Tooltip.Content>
        <span className='text-sm'>{message}</span>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

const EMPTY_COMBOBOX_GROUPS: ComboboxOptionGroup[] = []
const EMPTY_COMBOBOX_OPTIONS: ComboboxOption[] = []

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
  const activeSearchTarget = useActiveSearchTarget()
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)
  const [open, setOpen] = useState(false)
  const [customToolModalOpen, setCustomToolModalOpen] = useState(false)
  const [mcpModalOpen, setMcpModalOpen] = useState(false)
  const [editingToolIndex, setEditingToolIndex] = useState<number | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [usageControlPopoverIndex, setUsageControlPopoverIndex] = useState<number | null>(null)
  const [mcpRemovePopoverIndex, setMcpRemovePopoverIndex] = useState<number | null>(null)
  const [mcpServerDrilldown, setMcpServerDrilldown] = useState<string | null>(null)

  const canonicalModeOverrides = useWorkflowStore(
    useCallback(
      (state) => state.blocks[blockId]?.data?.canonicalModes as CanonicalModeOverrides | undefined,
      [blockId]
    )
  )
  const { collaborativeSetBlockCanonicalMode, collaborativeSetBlockCanonicalModes } =
    useCollaborativeWorkflow()
  const reindexCanonicalModesOnMutate = useCallback(
    (oldTools: StoredTool[], newTools: StoredTool[]) => {
      const next = reindexToolCanonicalModes(oldTools, newTools, canonicalModeOverrides)
      if (next) collaborativeSetBlockCanonicalModes(blockId, next)
    },
    [canonicalModeOverrides, collaborativeSetBlockCanonicalModes, blockId]
  )

  const value = isPreview ? previewValue : storeValue

  const selectedTools: StoredTool[] =
    Array.isArray(value) &&
    value.length > 0 &&
    value[0] !== null &&
    typeof value[0]?.type === 'string'
      ? (value as StoredTool[])
      : []

  // Tool categories the consuming block can't run (declared on its tool-input
  // subBlock): shown in the picker but greyed out with a tooltip instead of added.
  const blockType = useWorkflowStore(useCallback((state) => state.blocks[blockId]?.type, [blockId]))
  const unsupportedToolTypes = useMemo<readonly ('mcp' | 'custom-tool')[]>(() => {
    const block = blockType ? getBlock(blockType) : undefined
    return block?.subBlocks.find((sb) => sb.id === subBlockId)?.unsupportedToolTypes ?? []
  }, [blockType, subBlockId])
  const mcpUnsupported = unsupportedToolTypes.includes('mcp')
  const customUnsupported = unsupportedToolTypes.includes('custom-tool')

  // Look up credential type for reactive condition filtering (e.g. service account detection).
  // Uses canonical resolution so the active field (basic vs advanced) is respected.
  const toolCredentialId = useMemo(() => {
    for (const [toolIndex, tool] of selectedTools.entries()) {
      const blockConfig = tool.type ? getBlock(tool.type) : undefined
      if (!blockConfig?.subBlocks) continue
      // canonical-index-unscoped: a nested tool resolves against `tool.params`, which only ever
      // holds action-surface values — a tool is never invoked in trigger mode.
      const toolCanonical = buildCanonicalIndex(blockConfig.subBlocks)
      const scopedOverrides = scopeCanonicalModesForTool(
        canonicalModeOverrides,
        toolIndex,
        tool.type
      )
      const reactiveSubBlock = blockConfig.subBlocks.find(
        (sb: { reactiveCondition?: unknown }) => sb.reactiveCondition
      )
      const reactiveCond = reactiveSubBlock?.reactiveCondition as
        | { watchFields: string[]; requiredType: string }
        | undefined
      if (!reactiveCond) continue
      for (const field of reactiveCond.watchFields) {
        const val = resolveDependencyValue(field, tool.params || {}, toolCanonical, scopedOverrides)
        if (val && typeof val === 'string') return val
      }
    }
    return undefined
  }, [selectedTools, canonicalModeOverrides])
  const { data: toolCredential } = useWorkspaceCredential(
    toolCredentialId,
    Boolean(toolCredentialId)
  )

  const hasReferenceOnlyCustomTools = selectedTools.some(
    (tool) => tool.type === 'custom-tool' && tool.customToolId && !tool.code
  )
  const shouldFetchCustomTools = !isPreview || hasReferenceOnlyCustomTools
  const { data: customTools = [] } = useCustomTools(shouldFetchCustomTools ? workspaceId : '')

  const { mcpTools, isLoading: mcpLoading } = useMcpTools(workspaceId)
  const mcpToolNamesById = useMemo(() => {
    const names = new Map<string, string>()
    for (const t of mcpTools) {
      if (!names.has(t.id)) names.set(t.id, t.name)
    }
    return names
  }, [mcpTools])

  const { data: mcpServers = [], isLoading: mcpServersLoading } = useMcpToolServers(workspaceId)
  const { data: storedMcpTools = [] } = useStoredMcpTools(workspaceId)
  const forceRefreshMcpTools = useForceRefreshMcpTools().mutate
  const { navigateToSettings } = useSettingsNavigation()
  const createMcpServer = useCreateMcpServer()
  const { startOauthForServer } = useMcpOauthPopup({ workspaceId })
  const { data: allowedMcpDomains = null } = useAllowedMcpDomains()
  const availableEnvVars = useAvailableEnvVarKeys(workspaceId)
  const mcpDataLoading = mcpLoading || mcpServersLoading

  const { data: workflowsList = [] } = useWorkflows(workspaceId)
  const availableWorkflows = useMemo(
    () => workflowsList.filter((w) => w.id !== workflowId),
    [workflowsList, workflowId]
  )
  const hasRefreshedRef = useRef(false)

  const hasMcpTools = selectedTools.some(
    (tool) => tool.type === 'mcp' || tool.type === MCP_SERVER_ADVANCED_TOOL_TYPE
  )
  const supportsAdvancedMcpServer = blockType === 'agent' || blockType === 'mothership'

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
      const serverStates = mcpServers.map((s) => ({
        id: s.id,
        url: s.url,
        connectionStatus: s.connectionStatus,
        lastError: s.lastError ?? undefined,
      }))
      const discoveredTools = mcpTools.map((t) => ({
        serverId: t.serverId,
        name: t.name,
        inputSchema: t.inputSchema,
      }))

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
        serverStates,
        discoveredTools
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

  const {
    filterBlocks,
    config: permissionConfig,
    isLoading: isPermissionLoading,
  } = usePermissionConfig()
  const { getDeniedOperations } = useOperationAccess()

  /**
   * A tool block's selectable operations paired with the ones the caller's
   * permission group denies.
   *
   * Both callers derive from this single result so they cannot drift: the
   * picker *removes* denied operations (it must never offer or default to one),
   * while the editor's selector *hides* them (a tool already saved on one keeps
   * showing its name).
   */
  const getOperationChoices = useCallback(
    (block: BlockConfig | undefined) => {
      const options = getOperationOptions(block).filter((option) => option.id !== '')
      return {
        options,
        denied: getDeniedOperations(
          block,
          options.map((option) => option.id)
        ),
      }
    },
    [getDeniedOperations]
  )

  const customBlockOverlayVersion = useCustomBlockOverlayVersion()
  const toolBlocks = useMemo(() => {
    const allToolBlocks = getAllBlocks().filter(isAgentToolBlock)
    /* An empty option list means the block declares no selectable operation, so
       there is nothing to gate — only a wholly denied one leaves the picker. */
    return filterBlocks(allToolBlocks).filter((block) => {
      if (!hasMultipleOperations(block)) return true
      const { options, denied } = getOperationChoices(block)
      return options.length === 0 || options.some((option) => !denied.has(option.id))
    })
  }, [filterBlocks, customBlockOverlayVersion, getOperationChoices])

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
    if (hasMultipleOperations(getBlock(blockType))) {
      return false
    }
    // Custom blocks all share toolId `workflow_executor`, so dedup-by-toolId would
    // block a second (distinct) custom block — allow multiple like workflow/knowledge.
    if (blockType === 'workflow' || blockType === 'knowledge' || isCustomBlockType(blockType)) {
      return false
    }
    return selectedTools.some((tool) => tool.toolId === toolId)
  }

  /**
   * Groups MCP tools by their parent server.
   */
  const mcpToolsByServer = useMemo(() => {
    const grouped = new Map<string, typeof availableMcpTools>()
    for (const tool of availableMcpTools) {
      if (!grouped.has(tool.serverId)) {
        grouped.set(tool.serverId, [])
      }
      grouped.get(tool.serverId)!.push(tool)
    }
    return grouped
  }, [availableMcpTools])

  /**
   * Resets the MCP server drilldown when the combobox closes.
   */
  const handleComboboxOpenChange = useCallback((isOpen: boolean) => {
    setOpen(isOpen)
    if (!isOpen) {
      setMcpServerDrilldown(null)
    }
  }, [])

  const handleSelectTool = useCallback(
    (toolBlock: (typeof toolBlocks)[0]) => {
      if (isPreview || disabled) return

      const { options, denied } = hasMultipleOperations(toolBlock)
        ? getOperationChoices(toolBlock)
        : { options: [], denied: NO_DENIED_OPERATIONS }
      const defaultOperation = options.find((option) => !denied.has(option.id))?.id

      const toolId = getToolIdForOperation(toolBlock.type, defaultOperation, toolBlock)
      if (!toolId) return

      if (isToolAlreadySelected(toolId, toolBlock.type)) return

      const initialSubBlocks = getSubBlocksForToolInput(
        toolId,
        toolBlock.type,
        undefined,
        {},
        toolBlock
      )
      if (!initialSubBlocks) return

      const initialParams: Record<string, string> = {}

      initialSubBlocks.subBlocks.forEach((sb) => {
        if (initialParams[sb.id] !== undefined) return
        const seeded = sb.value ? sb.value({}) : sb.defaultValue
        if (seeded !== undefined && seeded !== null) {
          initialParams[sb.id] = encodeToolParamValue(seeded)
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
    [isPreview, disabled, isToolAlreadySelected, selectedTools, setStoreValue, getOperationChoices]
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
      const updatedTools = selectedTools.filter((_, index) => index !== toolIndex)
      reindexCanonicalModesOnMutate(selectedTools, updatedTools)
      setStoreValue(updatedTools)
    },
    [isPreview, disabled, selectedTools, reindexCanonicalModesOnMutate, setStoreValue]
  )

  const handleRemoveAllFromServer = useCallback(
    (serverId: string | undefined) => {
      if (isPreview || disabled || !serverId) return
      const updatedTools = selectedTools.filter(
        (t) => !(t.type === 'mcp' && t.params?.serverId === serverId)
      )
      reindexCanonicalModesOnMutate(selectedTools, updatedTools)
      setStoreValue(updatedTools)
    },
    [isPreview, disabled, selectedTools, reindexCanonicalModesOnMutate, setStoreValue]
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
        reindexCanonicalModesOnMutate(selectedTools, updatedTools)
        setStoreValue(updatedTools)
      }
    },
    [selectedTools, customTools, reindexCanonicalModesOnMutate, setStoreValue]
  )

  const handleParamChange = useCallback(
    (toolIndex: number, paramId: string, paramValue: string) => {
      if (isPreview || disabled) return

      setStoreValue(
        selectedTools.map((tool, index) => {
          if (index !== toolIndex) return tool
          // Clear the changed param's transitive `dependsOn` descendants (mirrors the top-level
          // block clear), so a child scoped to the old parent isn't left stale.
          const params = clearDependentToolParams(
            tool.type,
            { ...tool.params, [paramId]: paramValue },
            paramId
          )
          return { ...tool, params }
        })
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

      const newToolId = getToolIdForOperation(tool.type, operation, getBlock(tool.type))

      if (!newToolId) {
        return
      }

      const newToolConfig = getToolMetadata(newToolId)

      if (!newToolConfig) {
        return
      }

      const newParamIds = new Set(
        Object.entries(newToolConfig.params ?? {})
          .filter(([, param]) => isUserFacingToolParam(param))
          .map(([paramId]) => paramId)
      )

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

  const [localExpanded, setLocalExpanded] = useState<Record<number, boolean>>({})

  const toggleToolExpansion = (toolIndex: number) => {
    if (isPreview && !allowExpandInPreview) return

    if (isPreview || disabled) {
      setLocalExpanded((prev) => ({
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

  const handleMcpToolSelect = useCallback(
    (newTool: StoredTool, closePopover = true) => {
      setStoreValue([
        ...selectedTools.map((tool) => ({
          ...tool,
          isExpanded: false,
        })),
        newTool,
      ])

      if (closePopover) {
        setMcpServerDrilldown(null)
        setOpen(false)
      }
    },
    [selectedTools, setStoreValue]
  )

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

    reindexCanonicalModesOnMutate(selectedTools, newTools)
    setStoreValue(newTools)
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const getParamActiveSearchTarget = (
    toolIndex: number | undefined,
    paramId: string,
    syntheticSubBlockId: string
  ): ActiveSearchTarget | null => {
    if (toolIndex === undefined || activeSearchTarget?.subBlockId !== subBlockId) return null
    const [activeToolIndex, paramsKey, activeParamId, ...leafPath] = activeSearchTarget.valuePath
    if (activeToolIndex !== toolIndex || paramsKey !== 'params' || activeParamId !== paramId) {
      return null
    }
    return {
      ...activeSearchTarget,
      subBlockId: syntheticSubBlockId,
      canonicalSubBlockId: syntheticSubBlockId,
      valuePath: leafPath,
    }
  }

  const getToolTitleSearchHighlight = (toolIndex: number) =>
    getActiveWorkflowSearchHighlight({
      activeSearchTarget,
      blockId,
      subBlockId,
      valuePath: [toolIndex, 'title'],
    })

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
    if (!open) return EMPTY_COMBOBOX_GROUPS
    const groups: ComboboxOptionGroup[] = []

    // MCP Server drill-down: when navigated into a server, show only its tools
    if (
      mcpServerDrilldown &&
      !permissionConfig.disableMcpTools &&
      !mcpUnsupported &&
      mcpServers.some((server) => server.id === mcpServerDrilldown)
    ) {
      const tools = mcpToolsByServer.get(mcpServerDrilldown) ?? []
      const server = mcpServers.find((candidate) => candidate.id === mcpServerDrilldown)
      const ServerIcon = server?.managedConnectorId
        ? getManagedMcpConnectorIcon(server.managedConnectorId)
        : Server
      const serverName = tools[0]?.serverName || server?.name || 'Unknown Server'
      const allAlreadySelected = selectedTools.some(
        (tool) =>
          tool.type === MCP_SERVER_ADVANCED_TOOL_TYPE &&
          tool.params?.serverId === mcpServerDrilldown
      )
      const serverToolItems: ComboboxOption[] = []

      serverToolItems.push({
        label: 'Back',
        value: `mcp-server-back`,
        iconElement: <ArrowLeft className='size-[14px] text-[var(--text-tertiary)]' />,
        onSelect: () => {
          setMcpServerDrilldown(null)
        },
        keepOpen: true,
      })

      if (supportsAdvancedMcpServer) {
        serverToolItems.push({
          label: 'Use all available tools',
          value: `mcp-server-all-${mcpServerDrilldown}`,
          iconElement: createToolIcon('var(--brand-agent)', ServerIcon),
          onSelect: () => {
            if (allAlreadySelected) return
            const filteredTools = selectedTools.filter(
              (tool) =>
                !(
                  (tool.type === 'mcp' || tool.type === MCP_SERVER_ADVANCED_TOOL_TYPE) &&
                  tool.params?.serverId === mcpServerDrilldown
                )
            )
            const serverBinding: StoredTool = {
              type: MCP_SERVER_ADVANCED_TOOL_TYPE,
              params: { serverId: mcpServerDrilldown },
              isExpanded: false,
              usageControl: 'auto',
            }
            const nextTools = [
              ...filteredTools.map((tool) => ({ ...tool, isExpanded: false })),
              serverBinding,
            ]
            reindexCanonicalModesOnMutate(selectedTools, filteredTools)
            setStoreValue(nextTools)
            setMcpServerDrilldown(null)
            setOpen(false)
          },
          disabled: isPreview || disabled || allAlreadySelected,
        })
      }

      for (const mcpTool of tools) {
        const alreadySelected =
          allAlreadySelected || isMcpToolAlreadySelected(selectedTools, mcpTool.id)
        serverToolItems.push({
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
        })
      }

      groups.push({
        section: serverName,
        items: serverToolItems,
      })
      return groups
    }

    // Root view: show all tool categories
    const actionItems: ComboboxOption[] = []
    if (!permissionConfig.disableCustomTools) {
      actionItems.push({
        label: 'Create Tool',
        value: 'action-create-tool',
        icon: Wrench,
        onSelect: () => {
          setCustomToolModalOpen(true)
          setOpen(false)
        },
        disabled: isPreview || customUnsupported,
        suffixElement: customUnsupported ? (
          <UnsupportedToolBadge message={UNSUPPORTED_CUSTOM_TOOL_MESSAGE} />
        ) : undefined,
      })
    }
    if (!permissionConfig.disableMcpTools) {
      actionItems.push({
        label: 'Add MCP Server',
        value: 'action-add-mcp',
        icon: McpIcon,
        onSelect: () => {
          setOpen(false)
          setMcpModalOpen(true)
        },
        disabled: isPreview || mcpUnsupported,
        suffixElement: mcpUnsupported ? (
          <UnsupportedToolBadge message={UNSUPPORTED_MCP_TOOL_MESSAGE} />
        ) : undefined,
      })
    }
    if (actionItems.length > 0) {
      groups.push({ items: actionItems })
    }

    if (!permissionConfig.disableCustomTools && !customUnsupported && customTools.length > 0) {
      groups.push({
        section: 'Custom Tools',
        items: customTools.map((customTool) => {
          const alreadySelected = isCustomToolAlreadySelected(selectedTools, customTool.id)
          return {
            label: customTool.title,
            value: `custom-${customTool.id}`,
            iconElement: createToolIcon('#3B82F6', Wrench),
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

    // MCP Servers — root folder view
    if (!permissionConfig.disableMcpTools && !mcpUnsupported && mcpServers.length > 0) {
      const serverItems: ComboboxOption[] = []

      for (const server of mcpServers) {
        if (!server.enabled) continue
        const serverId = server.id
        const tools = mcpToolsByServer.get(serverId) ?? []
        const serverName = tools[0]?.serverName || server?.name || 'Unknown Server'
        const toolCount = tools.length
        const ServerIcon = server.managedConnectorId
          ? getManagedMcpConnectorIcon(server.managedConnectorId)
          : Server

        serverItems.push({
          label: `${serverName} (${toolCount} tools)`,
          value: `mcp-server-folder-${serverId}`,
          iconElement: createToolIcon('#6366F1', ServerIcon),
          suffixElement: <ChevronRight className='size-[12px] text-[var(--text-tertiary)]' />,
          onSelect: () => {
            setMcpServerDrilldown(serverId)
          },
          keepOpen: true,
        })
      }

      groups.push({
        section: 'MCP Servers',
        items: serverItems,
      })
    }

    const builtInTools = toolBlocks.filter((block) => BUILT_IN_TOOL_TYPES.has(block.type))
    const integrations = toolBlocks.filter((block) => !BUILT_IN_TOOL_TYPES.has(block.type))

    if (builtInTools.length > 0) {
      groups.push({
        section: 'Built-in Tools',
        items: builtInTools.map((block) => {
          const toolId = getToolIdForOperation(block.type, undefined, block)
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

    if (integrations.length > 0) {
      groups.push({
        section: 'Integrations',
        items: integrations.map((block) => {
          const toolId = getToolIdForOperation(block.type, undefined, block)
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

    if (!permissionConfig.disableMcpTools && supportsAdvancedMcpServer) {
      groups.push({
        section: 'Advanced',
        items: [
          {
            label: 'MCP Server (Advanced)',
            value: 'action-mcp-server-advanced',
            icon: Server,
            onSelect: () => {
              setStoreValue([
                ...selectedTools.map((tool) => ({ ...tool, isExpanded: false })),
                {
                  type: MCP_SERVER_ADVANCED_TOOL_TYPE,
                  params: { serverId: '' },
                  isExpanded: true,
                  usageControl: 'auto',
                },
              ])
              setOpen(false)
            },
            disabled: isPreview || disabled || mcpUnsupported,
            suffixElement: mcpUnsupported ? (
              <UnsupportedToolBadge message={UNSUPPORTED_MCP_TOOL_MESSAGE} />
            ) : undefined,
          },
        ],
      })
    }

    return groups
  }, [
    open,
    mcpServerDrilldown,
    customTools,
    availableMcpTools,
    mcpServers,
    mcpToolsByServer,
    toolBlocks,
    isPreview,
    disabled,
    selectedTools,
    setStoreValue,
    handleMcpToolSelect,
    handleSelectTool,
    permissionConfig.disableCustomTools,
    permissionConfig.disableMcpTools,
    mcpUnsupported,
    customUnsupported,
    supportsAdvancedMcpServer,
    availableWorkflows,
    isToolAlreadySelected,
    reindexCanonicalModesOnMutate,
  ])

  return (
    <div className='w-full space-y-2'>
      <Combobox
        options={EMPTY_COMBOBOX_OPTIONS}
        groups={toolGroups}
        placeholder='Add tool...'
        /* Every list this picker offers — blocks, operations, MCP and custom
           tools — reads as unrestricted until the permission config resolves,
           and adding a tool is a one-shot write that nothing revisits. Closed
           rather than optimistic for that beat. */
        disabled={disabled || isPermissionLoading}
        searchable
        searchPlaceholder='Search tools...'
        maxHeight={240}
        emptyMessage='No tools found'
        onOpenChange={handleComboboxOpenChange}
        onArrowLeft={mcpServerDrilldown ? () => setMcpServerDrilldown(null) : undefined}
      />

      {selectedTools.length > 0 &&
        selectedTools.map((tool, toolIndex) => {
          const isCustomTool = tool.type === 'custom-tool'
          const isMcpTool = tool.type === 'mcp'
          const isAdvancedMcpServer = tool.type === MCP_SERVER_ADVANCED_TOOL_TYPE
          const isMcpFamily = isMcpTool || isAdvancedMcpServer
          const isWorkflowTool = tool.type === 'workflow'
          // Fall back to the unfiltered registry so chips for types hidden
          // from the picker (permissions, hideFromToolbar) keep their chrome.
          const toolBlock =
            !isCustomTool && !isMcpFamily
              ? (toolBlocks.find((block) => block.type === tool.type) ?? getBlock(tool.type))
              : null

          const currentToolId =
            !isCustomTool && !isMcpFamily
              ? getToolIdForOperation(tool.type, tool.operation, toolBlock ?? undefined) ||
                tool.toolId ||
                ''
              : tool.toolId || ''

          const toolScopedOverrides = scopeCanonicalModesForTool(
            canonicalModeOverrides,
            toolIndex,
            tool.type
          )

          const subBlocksResult: SubBlocksForToolInput | null =
            !isCustomTool && !isMcpFamily && currentToolId
              ? getSubBlocksForToolInput(
                  currentToolId,
                  tool.type,
                  {
                    operation: tool.operation,
                    ...tool.params,
                  },
                  toolScopedOverrides,
                  toolBlock ?? undefined
                )
              : null

          const toolCanonicalIndex: CanonicalIndex | null = toolBlock?.subBlocks
            ? // canonical-index-unscoped: nested tool params are always the action surface
              buildCanonicalIndex(toolBlock.subBlocks)
            : null

          const mcpTool = isMcpTool ? mcpTools.find((t) => t.id === tool.toolId) : null
          const advancedMcpServer = isAdvancedMcpServer
            ? mcpServers.find((server) => server.id === tool.params?.serverId)
            : undefined
          const McpFamilyIcon = mcpTool?.icon
            ? mcpTool.icon
            : advancedMcpServer?.managedConnectorId
              ? getManagedMcpConnectorIcon(advancedMcpServer.managedConnectorId)
              : McpIcon
          const mcpTileColor = mcpTool?.bgColor || 'var(--brand-agent)'
          const mcpToolSchema = isMcpTool ? tool.schema || mcpTool?.inputSchema : null

          // Canonical name wins; stored title only when nothing resolves
          // (same policy as the canvas summary — see resolveStoredToolName).
          const toolDisplayName = isAdvancedMcpServer
            ? (mcpServers.find((server) => server.id === tool.params?.serverId)?.name ??
              'MCP Server (Advanced)')
            : (resolveStoredToolName(tool, { customTools, mcpToolNamesById }) ?? 'Unknown Tool')

          /**
           * Every field this tool row renders, as `SubBlockConfig`s. A registry tool's
           * come from its block (with params it does not surface synthesized from their
           * declared type); an MCP tool's are derived from its JSON Schema. Both then
           * render through the one canonical sub-block renderer.
           */
          const displaySubBlocks: BlockSubBlockConfig[] = isMcpFamily
            ? buildSubBlocksFromJsonSchema(
                isAdvancedMcpServer
                  ? ADVANCED_MCP_SERVER_TOOL_SCHEMA
                  : (mcpToolSchema ?? undefined),
                formatParameterLabel
              )
            : (subBlocksResult?.subBlocks ?? []).filter(
                (sb) =>
                  !sb.reactiveCondition ||
                  toolCredential?.type === sb.reactiveCondition.requiredType
              )

          const hasOperations =
            !isCustomTool && !isMcpFamily && hasMultipleOperations(toolBlock ?? undefined)
          const hasToolBody = hasOperations || displaySubBlocks.length > 0

          const isSearchExpanded =
            activeSearchTarget?.subBlockId === subBlockId &&
            activeSearchTarget.valuePath[0] === toolIndex &&
            activeSearchTarget.valuePath[1] === 'params'
          const isExpandedForDisplay = hasToolBody
            ? isPreview || disabled
              ? isSearchExpanded || (localExpanded[toolIndex] ?? !!tool.isExpanded)
              : isSearchExpanded || !!tool.isExpanded
            : false

          return (
            <div
              key={`${tool.customToolId || tool.toolId || toolIndex}-${toolIndex}`}
              className={cn(
                'group relative flex flex-col overflow-hidden rounded-sm border border-[var(--border-1)] transition-all duration-200 ease-in-out',
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
                  'flex items-center justify-between gap-2 rounded-t-[4px] bg-[var(--surface-4)] px-2 py-[6.5px]',
                  (isCustomTool || hasToolBody) && 'cursor-pointer'
                )}
                role={isCustomTool || hasToolBody ? 'button' : undefined}
                tabIndex={isCustomTool || hasToolBody ? 0 : undefined}
                onClick={() => {
                  if (isCustomTool) {
                    handleEditCustomTool(toolIndex)
                  } else if (hasToolBody) {
                    toggleToolExpansion(toolIndex)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    if (isCustomTool) {
                      handleEditCustomTool(toolIndex)
                    } else if (hasToolBody) {
                      toggleToolExpansion(toolIndex)
                    }
                  }
                }}
              >
                <div className='flex min-w-0 flex-1 items-center gap-2'>
                  <div
                    className='flex size-[16px] flex-shrink-0 items-center justify-center rounded-sm'
                    style={{
                      backgroundColor: isCustomTool
                        ? '#3B82F6'
                        : isMcpFamily
                          ? mcpTileColor
                          : isWorkflowTool
                            ? '#6366F1'
                            : toolBlock?.bgColor,
                    }}
                  >
                    {isCustomTool ? (
                      <Wrench className={cn('size-[10px]', getTileIconColorClass('#3B82F6'))} />
                    ) : isMcpFamily ? (
                      <IconComponent
                        icon={McpFamilyIcon}
                        className={cn('size-[10px]', getTileIconColorClass(mcpTileColor))}
                      />
                    ) : isWorkflowTool ? (
                      <IconComponent
                        icon={WorkflowIcon}
                        className={cn('size-[10px]', getTileIconColorClass('#6366F1'))}
                      />
                    ) : (
                      <IconComponent
                        icon={toolBlock?.icon}
                        className={cn('size-[10px]', getTileIconColorClass(toolBlock?.bgColor))}
                      />
                    )}
                  </div>
                  <span className='truncate text-[var(--text-primary)] text-small'>
                    {formatDisplayText(toolDisplayName ?? '', {
                      workflowSearchHighlight: getToolTitleSearchHighlight(toolIndex),
                    })}
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
                                navigateToSettings({ section: 'mcp', mcpServerId: serverId })
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
                <div className='flex flex-shrink-0 items-center gap-2'>
                  {supportsToolControl && !(isMcpTool && isMcpToolUnavailable(tool)) && (
                    <Popover
                      open={usageControlPopoverIndex === toolIndex}
                      onOpenChange={(open) => setUsageControlPopoverIndex(open ? toolIndex : null)}
                      colorScheme='inverted'
                    >
                      <PopoverTrigger asChild>
                        <button
                          className='flex items-center justify-center text-[var(--text-tertiary)] text-caption transition-colors hover-hover:text-[var(--text-primary)]'
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
                        className='gap-0.5'
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
                  {isMcpTool &&
                  selectedTools.filter(
                    (t) => t.type === 'mcp' && t.params?.serverId === tool.params?.serverId
                  ).length > 1 ? (
                    <Popover
                      open={mcpRemovePopoverIndex === toolIndex}
                      onOpenChange={(isOpen) => {
                        if (!isOpen) setMcpRemovePopoverIndex(null)
                      }}
                    >
                      <PopoverTrigger asChild>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveTool(toolIndex)
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setMcpRemovePopoverIndex(toolIndex)
                          }}
                          className='flex items-center justify-center text-[var(--text-tertiary)] transition-colors hover-hover:text-[var(--text-primary)]'
                          aria-label='Remove tool'
                        >
                          <X className='size-[13px]' />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        side='bottom'
                        align='end'
                        sideOffset={8}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        className='gap-0.5'
                        border
                      >
                        <PopoverItem
                          onClick={() => {
                            handleRemoveTool(toolIndex)
                            setMcpRemovePopoverIndex(null)
                          }}
                        >
                          Remove
                        </PopoverItem>
                        <PopoverItem
                          onClick={() => {
                            handleRemoveAllFromServer(tool.params?.serverId)
                            setMcpRemovePopoverIndex(null)
                          }}
                        >
                          Remove all from {tool.params?.serverName || 'server'}
                        </PopoverItem>
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemoveTool(toolIndex)
                      }}
                      className='flex items-center justify-center text-[var(--text-tertiary)] transition-colors hover-hover:text-[var(--text-primary)]'
                      aria-label='Remove tool'
                    >
                      <X className='size-[13px]' />
                    </button>
                  )}
                </div>
              </div>

              {!isCustomTool && isExpandedForDisplay && (
                <div className='flex flex-col gap-2.5 overflow-visible rounded-b-[4px] border-[var(--border-1)] border-t bg-[var(--surface-2)] p-2'>
                  {/* Operation dropdown for tools with multiple operations */}
                  {(() => {
                    if (!hasOperations) return null
                    const { options: operationOptions, denied } = getOperationChoices(
                      toolBlock ?? undefined
                    )
                    if (operationOptions.length === 0) return null

                    return (
                      <div className='relative space-y-1.5'>
                        <div className='text-[var(--text-primary)] text-small'>Operation</div>
                        <Combobox
                          options={operationOptions.map((option) => ({
                            label: option.label,
                            value: option.id,
                            hidden: denied.has(option.id),
                          }))}
                          value={
                            tool.operation ||
                            operationOptions.find((option) => !denied.has(option.id))?.id
                          }
                          onChange={(value) => handleOperationChange(toolIndex, value)}
                          placeholder='Select operation'
                          /* Denied operations only drop out once the config
                             resolves, and picking one rewrites the stored tool. */
                          disabled={disabled || isPermissionLoading}
                        />
                      </div>
                    )
                  })()}

                  {(() => {
                    const renderSubBlock = (sb: BlockSubBlockConfig): React.ReactNode => {
                      const effectiveParamId = sb.id
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
                              toolScopedOverrides
                            )
                          : undefined

                      const canonicalToggleProp =
                        hasCanonicalPair && canonicalMode && canonicalId
                          ? {
                              mode: canonicalMode,
                              onToggle: () => {
                                const nextMode = canonicalMode === 'advanced' ? 'basic' : 'advanced'
                                collaborativeSetBlockCanonicalMode(
                                  blockId,
                                  `${toolIndex}:${canonicalId}`,
                                  nextMode
                                )
                              },
                            }
                          : undefined

                      return (
                        <ActiveSearchTargetProvider
                          key={sb.id}
                          value={getParamActiveSearchTarget(
                            toolIndex,
                            effectiveParamId,
                            buildToolSubBlockId(subBlockId, toolIndex, effectiveParamId)
                          )}
                        >
                          <ToolSubBlockRenderer
                            blockId={blockId}
                            subBlockId={subBlockId}
                            toolIndex={toolIndex}
                            subBlock={sb}
                            effectiveParamId={effectiveParamId}
                            toolType={tool.type}
                            toolParams={tool.params}
                            onParamChange={handleParamChange}
                            disabled={disabled}
                            canonicalToggle={canonicalToggleProp}
                          />
                        </ActiveSearchTargetProvider>
                      )
                    }

                    return (
                      <div className='flex flex-col gap-3.5 pt-1'>
                        {displaySubBlocks.map(renderSubBlock)}
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )
        })}

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
                const resolved = resolveCustomToolFromReference(storedTool, customTools)

                if (resolved) {
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

      <McpServerFormModal
        open={mcpModalOpen}
        onOpenChange={setMcpModalOpen}
        mode='add'
        onSubmit={async (config) => {
          const result = await createMcpServer.mutateAsync({
            workspaceId,
            config: { ...config, enabled: true },
          })
          if (result.authType === 'oauth') {
            await startOauthForServer(result.serverId)
          }
        }}
        workspaceId={workspaceId}
        availableEnvVars={availableEnvVars}
        allowedMcpDomains={allowedMcpDomains}
      />
    </div>
  )
})
