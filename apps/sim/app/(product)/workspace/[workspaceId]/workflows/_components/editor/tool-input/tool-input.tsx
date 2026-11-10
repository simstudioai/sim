'use client'

import { type DragEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { ContextActionMenu } from '@sim/emcn/menu/action-menu'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { workspacePath } from '@/lib/navigation/paths'
import {
  type McpServerFormConfig,
  McpServerFormModal,
} from '@/app/(product)/workspace/[workspaceId]/_components/mcp-server-form/mcp-server-form'
import {
  ActiveSearchTargetProvider,
  useActiveSearchTarget,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { formatDisplayText } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'
import { getActiveWorkflowSearchHighlight } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import { ItemCard } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/item-card/item-card'
import { McpOperationPolicyEditor } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/mcp-operation-policy/mcp-operation-policy'
import type { CanonicalToggle } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/sub-block/sub-block'
import {
  CustomToolModal,
  type SavedCustomTool,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/tool-input/custom-tool-modal'
import {
  McpIssueBadge,
  WorkflowDeployBadge,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/tool-input/tool-badges'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/tool-input/tool-input.module.css'
import { ToolMark } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/tool-input/tool-mark'
import { ToolParam } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/tool-input/tool-param'
import {
  ToolPicker,
  type ToolPickerGroup,
  type ToolPickerItem,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/tool-input/tool-picker'
import { ToolUsageControl } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/tool-input/usage-control'
import {
  type ActiveSearchTarget,
  type BlockConfig,
  buildCanonicalIndex,
  getBlock,
  isCanonicalPair,
  resolveCanonicalMode,
  type SubBlockConfig,
  useAvailableEnvVarKeys,
  useCollaborativeWorkflow,
  useSubBlockStore,
  useSubBlockValue,
  useWorkflowScope,
  useWorkflowStore,
} from '@/platform/lib/data/workflow-editor'
import {
  ADVANCED_MCP_SERVER_TOOL_SCHEMA,
  buildAgentToolUsageControlCanonicalKey,
  buildSubBlocksFromJsonSchema,
  buildToolSubBlockId,
  type CanonicalModeOverrides,
  clearDependentToolParams,
  encodeToolParamValue,
  formatParameterLabel,
  getAgentToolUsageControlMode,
  getAllBlocks,
  getManagedMcpConnectorIcon,
  getOperationOptions,
  getParamsForToolOperation,
  getProviderFromModel,
  getSubBlocksForToolInput,
  getToolIdForOperation,
  getToolMetadata,
  hasMultipleOperations,
  isAgentToolBlock,
  isCoreAgentToolBlock,
  isCustomBlockType,
  isCustomToolAlreadySelected,
  isMcpToolAlreadySelected,
  isToolUnavailable,
  isWorkflowAlreadySelected,
  MCP_SERVER_ADVANCED_TOOL_TYPE,
  type McpToolSchema,
  mcpToolSchemaOf,
  NO_DENIED_OPERATIONS,
  reindexToolCanonicalModes,
  resolveAgentToolUsageControl,
  resolveCustomToolFromReference,
  resolveDependencyValue,
  resolveStoredToolName,
  type StoredTool,
  scopeCanonicalModesForTool,
  supportsForcedToolUse,
  supportsToolUsageControl,
  toolInputLogger,
  useAllowedMcpDomains,
  useCreateMcpServer,
  useCustomBlockOverlayVersion,
  useCustomTools,
  useForceRefreshMcpTools,
  useMcpOauthPopup,
  useMcpToolServers,
  useMcpTools,
  useOperationAccess,
  usePermissionConfig,
  useStoredMcpTools,
  useWorkflows,
  useWorkspaceCredential,
  getMcpToolIssue as validateMcpTool,
} from '@/platform/lib/data/workflow-editor/tool-input'
import { usePlatformHref } from '@/platform/lib/platform-href'

const UNSUPPORTED_CUSTOM_TOOL_MESSAGE = 'Custom tools are not supported by this block yet'
const UNSUPPORTED_MCP_TOOL_MESSAGE = 'MCP tools are not supported by this block yet'
const EMPTY_GROUPS: readonly ToolPickerGroup[] = []

interface ToolInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  /** The stored tool list in preview mode. */
  previewValue?: unknown
  disabled?: boolean
  /** Let a preview open and close its tools' settings. */
  allowExpandInPreview?: boolean
}

/** Whether a stored value is a tool list, judged as the editor always has: by its first entry. */
function isStoredToolList(value: unknown): value is StoredTool[] {
  if (!Array.isArray(value) || value.length === 0) return false
  const first: unknown = value[0]
  return (
    typeof first === 'object' && first !== null && 'type' in first && typeof first.type === 'string'
  )
}

function collapsed(tools: readonly StoredTool[]): StoredTool[] {
  return tools.map((tool) => ({ ...tool, isExpanded: false }))
}

/**
 * The Agent block's tools: a picker that adds integrations, custom tools, MCP tools and servers,
 * and workflows, over the selected tools as cards that reorder by drag. Each card configures its
 * operation, its parameters through the shared sub-block fields, and how the model may use it.
 */
export const ToolInput = memo(function ToolInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  allowExpandInPreview,
}: ToolInputProps) {
  const { workspaceId, workflowId } = useWorkflowScope()
  const hrefFor = usePlatformHref()
  const activeSearchTarget = useActiveSearchTarget()
  const [storeValue, setStoreValue] = useSubBlockValue<StoredTool[]>(blockId, subBlockId)
  const [open, setOpen] = useState(false)
  const [customToolModalOpen, setCustomToolModalOpen] = useState(false)
  const [mcpModalOpen, setMcpModalOpen] = useState(false)
  const [editingToolIndex, setEditingToolIndex] = useState<number | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [mcpServerDrilldown, setMcpServerDrilldown] = useState<string | null>(null)
  const [localExpanded, setLocalExpanded] = useState<Record<number, boolean>>({})

  const canonicalModeOverrides: CanonicalModeOverrides | undefined = useWorkflowStore(
    useCallback((state) => state.blocks[blockId]?.data?.canonicalModes, [blockId])
  )
  const { collaborativeSetBlockCanonicalMode, collaborativeSetSubblockValueWithCanonicalModes } =
    useCollaborativeWorkflow()

  const value: unknown = isPreview ? previewValue : storeValue
  const selectedTools: StoredTool[] = isStoredToolList(value) ? value : []

  /**
   * Commits a list that moves or drops tools. Their canonical-mode overrides are keyed by position,
   * so when any must move they persist in the same operation as the list. `positionedTools` holds
   * the kept tool references when `nextTools` clones them.
   */
  const setToolsWithReindexedModes = useCallback(
    (nextTools: StoredTool[], positionedTools: StoredTool[] = nextTools) => {
      const canonicalModes = reindexToolCanonicalModes(
        selectedTools,
        positionedTools,
        canonicalModeOverrides
      )
      if (!canonicalModes) {
        setStoreValue(nextTools)
        return
      }
      collaborativeSetSubblockValueWithCanonicalModes(
        blockId,
        subBlockId,
        structuredClone(nextTools),
        canonicalModes
      )
    },
    [
      selectedTools,
      canonicalModeOverrides,
      setStoreValue,
      collaborativeSetSubblockValueWithCanonicalModes,
      blockId,
      subBlockId,
    ]
  )

  const blockType = useWorkflowStore(useCallback((state) => state.blocks[blockId]?.type, [blockId]))
  const unsupportedToolTypes = useMemo<readonly ('mcp' | 'custom-tool')[]>(() => {
    const block = blockType ? getBlock(blockType) : undefined
    return block?.subBlocks.find((sb) => sb.id === subBlockId)?.unsupportedToolTypes ?? []
  }, [blockType, subBlockId])
  const mcpUnsupported = unsupportedToolTypes.includes('mcp')
  const customUnsupported = unsupportedToolTypes.includes('custom-tool')

  // A credential-type condition (a service account, say) follows whichever credential field is active.
  const toolCredentialId = useMemo(() => {
    for (const [toolIndex, tool] of selectedTools.entries()) {
      const blockConfig = tool.type ? getBlock(tool.type) : undefined
      if (!blockConfig?.subBlocks) continue
      const reactiveSubBlock = blockConfig.subBlocks.find((sb) => sb.reactiveCondition)
      const reactiveCondition = reactiveSubBlock?.reactiveCondition
      if (!reactiveCondition) continue
      // canonical-index-unscoped: a nested tool's params are only ever the action surface.
      const toolCanonical = buildCanonicalIndex(blockConfig.subBlocks)
      const scopedOverrides = scopeCanonicalModesForTool(
        canonicalModeOverrides,
        toolIndex,
        tool.type
      )
      for (const field of reactiveCondition.watchFields) {
        const resolved = resolveDependencyValue(
          field,
          tool.params || {},
          toolCanonical,
          scopedOverrides
        )
        if (resolved && typeof resolved === 'string') return resolved
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
    for (const tool of mcpTools) {
      if (!names.has(tool.id)) names.set(tool.id, tool.name)
    }
    return names
  }, [mcpTools])

  const { data: mcpServers = [], isLoading: mcpServersLoading } = useMcpToolServers(workspaceId)
  const { data: storedMcpTools = [] } = useStoredMcpTools(workspaceId)
  const forceRefreshMcpTools = useForceRefreshMcpTools().mutate
  const createMcpServer = useCreateMcpServer()
  const { startOauthForServer } = useMcpOauthPopup({ workspaceId })
  const { data: allowedMcpDomains = null } = useAllowedMcpDomains()
  const availableEnvVars = useAvailableEnvVarKeys(workspaceId)
  const mcpDataLoading = mcpLoading || mcpServersLoading

  const { data: workflowsList = [] } = useWorkflows(workspaceId)
  const availableWorkflows = useMemo(
    () => workflowsList.filter((workflow) => workflow.id !== workflowId),
    [workflowsList, workflowId]
  )

  const hasMcpTools = selectedTools.some(
    (tool) => tool.type === 'mcp' || tool.type === MCP_SERVER_ADVANCED_TOOL_TYPE
  )
  const supportsAdvancedMcpServer = blockType === 'agent' || blockType === 'mothership'

  const hasRefreshedRef = useRef(false)
  useEffect(() => {
    if (isPreview) return
    if (hasMcpTools && !hasRefreshedRef.current) {
      hasRefreshedRef.current = true
      forceRefreshMcpTools(workspaceId)
    }
  }, [hasMcpTools, forceRefreshMcpTools, workspaceId, isPreview])

  /**
   * What is wrong with a selected MCP tool. The stored schema from the last refresh wins, so a
   * refresh updates the badge at once; the schema saved on the tool covers the rest.
   */
  const getMcpToolIssue = useCallback(
    (tool: StoredTool) => {
      if (tool.type !== 'mcp') return null
      const serverId = tool.params?.serverId ?? ''
      const toolName = tool.params?.toolName ?? ''
      const serverStates = mcpServers.map((server) => ({
        id: server.id,
        url: server.url,
        connectionStatus: server.connectionStatus,
        lastError: server.lastError ?? undefined,
      }))
      const discoveredTools = mcpTools.map((discovered) => ({
        serverId: discovered.serverId,
        name: discovered.name,
        inputSchema: discovered.inputSchema,
      }))
      const storedTool =
        storedMcpTools.find(
          (stored) =>
            stored.serverId === serverId &&
            stored.toolName === toolName &&
            stored.workflowId === workflowId
        ) ||
        storedMcpTools.find(
          (stored) => stored.serverId === serverId && stored.toolName === toolName
        )
      const schema: McpToolSchema | undefined = storedTool?.schema ?? mcpToolSchemaOf(tool)
      return validateMcpTool(
        { serverId, serverUrl: tool.params?.serverUrl, toolName, schema },
        serverStates,
        discoveredTools
      )
    },
    [mcpTools, mcpServers, storedMcpTools, workflowId]
  )

  const availableMcpTools = useMemo(
    () =>
      mcpTools.filter((mcpTool) => {
        const server = mcpServers.find((candidate) => candidate.id === mcpTool.serverId)
        return server?.connectionStatus === 'connected'
      }),
    [mcpTools, mcpServers]
  )

  const modelValue = useSubBlockStore((state) => state.getValue(blockId, 'model'))
  const model = typeof modelValue === 'string' ? modelValue : ''
  const provider = model ? getProviderFromModel(model) : ''
  const supportsToolControl =
    blockType === 'mothership' || (provider ? supportsToolUsageControl(provider) : false)
  const supportsForce = blockType === 'mothership' || supportsForcedToolUse(model)

  const {
    filterBlocks,
    config: permissionConfig,
    isLoading: isPermissionLoading,
  } = usePermissionConfig()
  const { getDeniedOperations } = useOperationAccess()

  /**
   * A tool block's operations with the ones the viewer's permission group denies. The picker
   * removes denied operations, while a saved tool's selector hides them but keeps its own name.
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
  // The overlay version is a dependency so custom blocks re-read once they load.
  const toolBlocks = useMemo(() => {
    const allToolBlocks = getAllBlocks().filter(isAgentToolBlock)
    // A block that declares no selectable operation has nothing to gate; only a wholly denied one leaves.
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
    const needingUpdate = selectedTools.filter(
      (tool) =>
        tool.type === 'mcp' && tool.params?.toolName && (!tool.schema || !tool.schema.description)
    )
    if (needingUpdate.length === 0) return

    const updatedTools = selectedTools.map((tool) => {
      if (tool.type !== 'mcp' || !tool.params?.toolName || tool.schema?.description) return tool
      const mcpTool = mcpTools.find(
        (candidate) =>
          candidate.name === tool.params?.toolName && candidate.serverId === tool.params?.serverId
      )
      if (!mcpTool?.inputSchema) return tool
      toolInputLogger.info('Backfilling schema for MCP tool', { toolName: tool.params.toolName })
      return { ...tool, schema: { ...mcpTool.inputSchema, description: mcpTool.description } }
    })

    const hasChanges = updatedTools.some(
      (tool, index) =>
        (tool.schema && !selectedTools[index].schema) ||
        (tool.schema?.description && !selectedTools[index].schema?.description)
    )
    if (hasChanges) {
      hasBackfilledRef.current = true
      toolInputLogger.info('Backfilled MCP tool schemas', { count: needingUpdate.length })
      setStoreValue(updatedTools)
    }
  }, [mcpTools, mcpLoading, selectedTools, isPreview, setStoreValue])

  /**
   * Whether a single-operation tool is already selected. Multi-operation tools, workflow, knowledge
   * and custom blocks may be added more than once.
   */
  const isToolAlreadySelected = useCallback(
    (toolId: string, toolBlockType: string) => {
      if (hasMultipleOperations(getBlock(toolBlockType))) return false
      // Custom blocks share the `workflow_executor` tool id, so deduplicating by it would block a
      // second, distinct custom block.
      if (
        toolBlockType === 'workflow' ||
        toolBlockType === 'knowledge' ||
        isCustomBlockType(toolBlockType)
      ) {
        return false
      }
      return selectedTools.some((tool) => tool.toolId === toolId)
    },
    [selectedTools]
  )

  const mcpToolsByServer = useMemo(() => {
    const grouped = new Map<string, typeof availableMcpTools>()
    for (const tool of availableMcpTools) {
      const list = grouped.get(tool.serverId)
      if (list) list.push(tool)
      else grouped.set(tool.serverId, [tool])
    }
    return grouped
  }, [availableMcpTools])

  const handlePickerOpenChange = useCallback((isOpen: boolean) => {
    setOpen(isOpen)
    if (!isOpen) setMcpServerDrilldown(null)
  }, [])

  const appendTool = useCallback(
    (newTool: StoredTool) => {
      setStoreValue([...collapsed(selectedTools), newTool])
    },
    [selectedTools, setStoreValue]
  )

  const handleSelectTool = useCallback(
    (toolBlock: BlockConfig) => {
      if (isPreview || disabled) return
      const { options, denied } = hasMultipleOperations(toolBlock)
        ? getOperationChoices(toolBlock)
        : { options: [], denied: NO_DENIED_OPERATIONS }
      const defaultOperation = options.find((option) => !denied.has(option.id))?.id
      const toolId = getToolIdForOperation(toolBlock.type, defaultOperation, toolBlock)
      if (!toolId || isToolAlreadySelected(toolId, toolBlock.type)) return

      const initialSubBlocks = getSubBlocksForToolInput(
        toolId,
        toolBlock.type,
        undefined,
        {},
        toolBlock
      )
      if (!initialSubBlocks) return

      const initialParams: Record<string, string> = {}
      for (const sb of initialSubBlocks.subBlocks) {
        if (initialParams[sb.id] !== undefined) continue
        const seeded = sb.value ? sb.value({}) : sb.defaultValue
        if (seeded !== undefined && seeded !== null) {
          initialParams[sb.id] = encodeToolParamValue(seeded)
        }
      }

      appendTool({
        type: toolBlock.type,
        title: toolBlock.name,
        toolId,
        params: initialParams,
        isExpanded: true,
        operation: defaultOperation,
        usageControl: 'auto',
      })
    },
    [isPreview, disabled, getOperationChoices, isToolAlreadySelected, appendTool]
  )

  const handleAddCustomTool = useCallback(
    (customTool: SavedCustomTool) => {
      if (isPreview || disabled) return
      // A saved tool is stored by reference; one without an id keeps its definition inline.
      appendTool(
        customTool.id
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
      )
    },
    [isPreview, disabled, appendTool]
  )

  const handleEditCustomTool = useCallback(
    (toolIndex: number) => {
      const tool = selectedTools[toolIndex]
      if (tool?.type !== 'custom-tool') return
      const resolved = resolveCustomToolFromReference(tool, customTools)
      if (!resolved && !tool.schema) {
        toolInputLogger.warn('Cannot edit custom tool: not found and no inline definition')
        return
      }
      setEditingToolIndex(toolIndex)
      setCustomToolModalOpen(true)
    },
    [selectedTools, customTools]
  )

  const handleSaveCustomTool = useCallback(
    (customTool: SavedCustomTool) => {
      if (isPreview || disabled) return
      if (editingToolIndex === null) {
        handleAddCustomTool(customTool)
        return
      }
      const existingTool = selectedTools[editingToolIndex]
      const updatedTool: StoredTool = customTool.id
        ? {
            type: 'custom-tool',
            customToolId: customTool.id,
            usageControl: existingTool.usageControl || 'auto',
            usageControlExpression: existingTool.usageControlExpression,
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
    },
    [isPreview, disabled, editingToolIndex, selectedTools, setStoreValue, handleAddCustomTool]
  )

  const handleRemoveTool = (toolIndex: number) => {
    if (isPreview || disabled) return
    setToolsWithReindexedModes(selectedTools.filter((_, index) => index !== toolIndex))
  }

  const handleRemoveAllFromServer = (serverId: string | undefined) => {
    if (isPreview || disabled || !serverId) return
    setToolsWithReindexedModes(
      selectedTools.filter((tool) => !(tool.type === 'mcp' && tool.params?.serverId === serverId))
    )
  }

  const handleDeleteTool = (toolId: string) => {
    const updatedTools = selectedTools.filter((tool) => {
      if (tool.type !== 'custom-tool') return true
      if (tool.customToolId === toolId) return false
      // An inline tool matches the deleted record by its function name.
      const functionName = tool.schema?.function?.name
      return !(
        functionName &&
        customTools.some(
          (customTool) =>
            customTool.id === toolId && customTool.schema?.function?.name === functionName
        )
      )
    })
    if (updatedTools.length !== selectedTools.length) setToolsWithReindexedModes(updatedTools)
  }

  const handleParamChange = useCallback(
    (toolIndex: number, paramId: string, paramValue: string) => {
      if (isPreview || disabled) return
      setStoreValue(
        selectedTools.map((tool, index) => {
          if (index !== toolIndex) return tool
          // Clears the param's transitive dependents, as a block field change does.
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

  const handleOperationChange = (toolIndex: number, operation: string) => {
    if (isPreview || disabled) return
    const tool = selectedTools[toolIndex]
    const newToolId = getToolIdForOperation(tool.type, operation, getBlock(tool.type))
    if (!newToolId) return
    const newToolConfig = getToolMetadata(newToolId)
    if (!newToolConfig) return
    const preservedParams = getParamsForToolOperation(tool, newToolConfig)

    if (tool.type === 'jira') {
      const subBlockStore = useSubBlockStore.getState()
      for (const field of ['summary', 'description', 'issueKey', 'projectId', 'parentIssue']) {
        subBlockStore.setValue(blockId, field, '')
      }
    }

    setStoreValue(
      selectedTools.map((candidate, index) =>
        index === toolIndex
          ? { ...candidate, toolId: newToolId, operation, params: preservedParams }
          : candidate
      )
    )
  }

  const updateTool = (toolIndex: number, patch: Partial<StoredTool>) => {
    if (isPreview || disabled) return
    setStoreValue(
      selectedTools.map((tool, index) => (index === toolIndex ? { ...tool, ...patch } : tool))
    )
  }

  const toggleToolExpansion = (toolIndex: number) => {
    if (isPreview && !allowExpandInPreview) return
    if (isPreview || disabled) {
      setLocalExpanded((current) => ({
        ...current,
        [toolIndex]: !(current[toolIndex] ?? Boolean(selectedTools[toolIndex]?.isExpanded)),
      }))
      return
    }
    setStoreValue(
      selectedTools.map((tool, index) =>
        index === toolIndex ? { ...tool, isExpanded: !tool.isExpanded } : tool
      )
    )
  }

  const handleDragStart = (event: DragEvent<HTMLDivElement>, index: number) => {
    if (isPreview || disabled) return
    setDraggedIndex(index)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/html', '')
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>, index: number) => {
    if (isPreview || disabled || draggedIndex === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>, dropIndex: number) => {
    if (isPreview || disabled || draggedIndex === null || draggedIndex === dropIndex) return
    event.preventDefault()
    const newTools = [...selectedTools]
    const [draggedTool] = newTools.splice(draggedIndex, 1)
    if (dropIndex === selectedTools.length) {
      newTools.push(draggedTool)
    } else {
      newTools.splice(draggedIndex < dropIndex ? dropIndex - 1 : dropIndex, 0, draggedTool)
    }
    setToolsWithReindexedModes(newTools)
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const openMcpSettings = (serverId: string | undefined) => {
    const base = workspacePath(workspaceId, 'settings/mcp')
    const href = serverId ? `${base}?mcpServerId=${encodeURIComponent(serverId)}` : base
    window.open(hrefFor(href), '_blank', 'noopener')
  }

  const getParamActiveSearchTarget = (
    toolIndex: number,
    paramId: string,
    syntheticSubBlockId: string
  ): ActiveSearchTarget | null => {
    if (activeSearchTarget?.subBlockId !== subBlockId) return null
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

  const toolGroups = useMemo((): readonly ToolPickerGroup[] => {
    if (!open) return EMPTY_GROUPS
    const inert = isPreview || disabled

    if (
      mcpServerDrilldown &&
      !permissionConfig.disableMcpTools &&
      !mcpUnsupported &&
      mcpServers.some((server) => server.id === mcpServerDrilldown)
    ) {
      const tools = mcpToolsByServer.get(mcpServerDrilldown) ?? []
      const server = mcpServers.find((candidate) => candidate.id === mcpServerDrilldown)
      const serverName = tools[0]?.serverName || server?.name || 'Unknown Server'
      const allAlreadySelected = selectedTools.some(
        (tool) =>
          tool.type === MCP_SERVER_ADVANCED_TOOL_TYPE &&
          tool.params?.serverId === mcpServerDrilldown
      )
      const items: ToolPickerItem[] = [
        {
          id: 'mcp-server-back',
          label: 'Back',
          leading: <ToolMark glyph='I093' />,
          keepOpen: true,
          pinned: true,
          onSelect: () => setMcpServerDrilldown(null),
        },
      ]
      if (supportsAdvancedMcpServer) {
        items.push({
          id: `mcp-server-all-${mcpServerDrilldown}`,
          label: 'Configure operations access',
          leading: (
            <ToolMark
              glyph='I126'
              artwork={
                server?.managedConnectorId
                  ? getManagedMcpConnectorIcon(server.managedConnectorId)
                  : undefined
              }
            />
          ),
          disabled: inert || allAlreadySelected,
          onSelect: () => {
            const filteredTools = selectedTools.filter(
              (tool) =>
                !(
                  (tool.type === 'mcp' || tool.type === MCP_SERVER_ADVANCED_TOOL_TYPE) &&
                  tool.params?.serverId === mcpServerDrilldown
                )
            )
            const serverBinding: StoredTool = {
              type: MCP_SERVER_ADVANCED_TOOL_TYPE,
              operationPolicy: { mode: 'allow', operations: [] },
              params: { serverId: mcpServerDrilldown },
              isExpanded: true,
              usageControl: 'auto',
            }
            setToolsWithReindexedModes([...collapsed(filteredTools), serverBinding], filteredTools)
            setMcpServerDrilldown(null)
          },
        })
      }
      for (const mcpTool of tools) {
        const alreadySelected =
          allAlreadySelected || isMcpToolAlreadySelected(selectedTools, mcpTool.id)
        items.push({
          id: `mcp-${mcpTool.id}`,
          label: mcpTool.name,
          leading: <ToolMark glyph='I126' artwork={mcpTool.icon} />,
          disabled: inert || alreadySelected,
          onSelect: () => {
            appendTool({
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
              schema: { ...mcpTool.inputSchema, description: mcpTool.description },
            })
            setMcpServerDrilldown(null)
          },
        })
      }
      return [{ id: `mcp-server-${mcpServerDrilldown}`, heading: serverName, items }]
    }

    const groups: ToolPickerGroup[] = []
    const actionItems: ToolPickerItem[] = []
    if (!permissionConfig.disableCustomTools) {
      actionItems.push({
        id: 'action-create-tool',
        label: 'Create Tool',
        leading: <ToolMark glyph='I127' />,
        disabled: isPreview || customUnsupported,
        unavailableReason: customUnsupported ? UNSUPPORTED_CUSTOM_TOOL_MESSAGE : undefined,
        onSelect: () => setCustomToolModalOpen(true),
      })
    }
    if (!permissionConfig.disableMcpTools) {
      actionItems.push({
        id: 'action-add-mcp',
        label: 'Add MCP Server',
        leading: <ToolMark glyph='I126' />,
        disabled: isPreview || mcpUnsupported,
        unavailableReason: mcpUnsupported ? UNSUPPORTED_MCP_TOOL_MESSAGE : undefined,
        onSelect: () => setMcpModalOpen(true),
      })
    }
    if (actionItems.length > 0) groups.push({ id: 'actions', items: actionItems })

    if (!permissionConfig.disableCustomTools && !customUnsupported && customTools.length > 0) {
      groups.push({
        id: 'custom-tools',
        heading: 'Custom Tools',
        items: customTools.map((customTool) => {
          const alreadySelected = isCustomToolAlreadySelected(selectedTools, customTool.id)
          return {
            id: `custom-${customTool.id}`,
            label: customTool.title,
            leading: <ToolMark glyph='I127' />,
            disabled: isPreview || alreadySelected,
            onSelect: () =>
              appendTool({
                type: 'custom-tool',
                customToolId: customTool.id,
                usageControl: 'auto',
                isExpanded: true,
              }),
          }
        }),
      })
    }

    if (!permissionConfig.disableMcpTools && !mcpUnsupported && mcpServers.length > 0) {
      const serverItems: ToolPickerItem[] = []
      for (const server of mcpServers) {
        if (!server.enabled) continue
        const tools = mcpToolsByServer.get(server.id) ?? []
        const serverName = tools[0]?.serverName || server.name || 'Unknown Server'
        serverItems.push({
          id: `mcp-server-folder-${server.id}`,
          label: `${serverName} (${tools.length} tools)`,
          leading: (
            <ToolMark
              glyph='I126'
              artwork={
                server.managedConnectorId
                  ? getManagedMcpConnectorIcon(server.managedConnectorId)
                  : undefined
              }
            />
          ),
          nested: true,
          onSelect: () => setMcpServerDrilldown(server.id),
        })
      }
      groups.push({ id: 'mcp-servers', heading: 'MCP Servers', items: serverItems })
    }

    const blockItem = (block: BlockConfig): ToolPickerItem => {
      const toolId = getToolIdForOperation(block.type, undefined, block)
      const alreadySelected = toolId ? isToolAlreadySelected(toolId, block.type) : false
      return {
        id: `builtin-${block.type}`,
        label: block.name,
        leading: <ToolMark blockType={block.type} fallbackLabel={block.name.charAt(0)} />,
        disabled: isPreview || alreadySelected,
        onSelect: () => handleSelectTool(block),
      }
    }
    const builtInTools = toolBlocks.filter(isCoreAgentToolBlock)
    const integrations = toolBlocks.filter((block) => !isCoreAgentToolBlock(block))
    if (builtInTools.length > 0) {
      groups.push({ id: 'built-in', heading: 'Built-in Tools', items: builtInTools.map(blockItem) })
    }
    if (integrations.length > 0) {
      groups.push({
        id: 'integrations',
        heading: 'Integrations',
        items: integrations.map(blockItem),
      })
    }

    if (availableWorkflows.length > 0) {
      groups.push({
        id: 'workflows',
        heading: 'Workflows',
        items: availableWorkflows.map((workflow) => {
          const alreadySelected = isWorkflowAlreadySelected(selectedTools, workflow.id)
          return {
            id: `workflow-${workflow.id}`,
            label: workflow.name,
            leading: <ToolMark glyph='I118' />,
            disabled: inert || alreadySelected,
            onSelect: () =>
              appendTool({
                type: 'workflow_input',
                title: 'Workflow',
                toolId: 'workflow_executor',
                params: { workflowId: workflow.id },
                isExpanded: true,
                usageControl: 'auto',
              }),
          }
        }),
      })
    }

    if (!permissionConfig.disableMcpTools && supportsAdvancedMcpServer) {
      groups.push({
        id: 'advanced',
        heading: 'Advanced',
        items: [
          {
            id: 'action-mcp-server-advanced',
            label: 'MCP Server (Advanced)',
            leading: <ToolMark glyph='I126' />,
            disabled: inert || mcpUnsupported,
            unavailableReason: mcpUnsupported ? UNSUPPORTED_MCP_TOOL_MESSAGE : undefined,
            onSelect: () =>
              appendTool({
                type: MCP_SERVER_ADVANCED_TOOL_TYPE,
                operationPolicy: { mode: 'allow', operations: [] },
                params: { serverId: '' },
                isExpanded: true,
                usageControl: 'auto',
              }),
          },
        ],
      })
    }

    return groups
  }, [
    open,
    mcpServerDrilldown,
    customTools,
    mcpServers,
    mcpToolsByServer,
    toolBlocks,
    isPreview,
    disabled,
    selectedTools,
    appendTool,
    handleSelectTool,
    permissionConfig.disableCustomTools,
    permissionConfig.disableMcpTools,
    mcpUnsupported,
    customUnsupported,
    supportsAdvancedMcpServer,
    availableWorkflows,
    isToolAlreadySelected,
    setToolsWithReindexedModes,
  ])

  const editingTool = editingToolIndex === null ? undefined : selectedTools[editingToolIndex]
  const customToolInitialValues = useMemo(() => {
    if (editingTool?.type !== 'custom-tool') return undefined
    const resolved = resolveCustomToolFromReference(editingTool, customTools)
    if (resolved) {
      const resolvedName = resolved.schema?.function?.name
      const record = editingTool.customToolId
        ? customTools.find((tool) => tool.id === editingTool.customToolId)
        : customTools.find((tool) => tool.schema?.function?.name === resolvedName)
      return { id: record?.id, schema: resolved.schema, code: resolved.code }
    }
    const storedName = editingTool.schema?.function?.name
    return {
      id: customTools.find((tool) => tool.schema?.function?.name === storedName)?.id,
      schema: editingTool.schema,
      code: editingTool.code || '',
    }
  }, [editingTool, customTools])

  return (
    <div className={styles.toolInput}>
      <ToolPicker
        open={open}
        onOpenChange={handlePickerOpenChange}
        groups={toolGroups}
        // Every list reads as unrestricted until the permission config resolves, and adding a tool
        // is a one-shot write nothing revisits, so the picker stays closed for that beat.
        disabled={disabled || isPermissionLoading}
        onBack={mcpServerDrilldown ? () => setMcpServerDrilldown(null) : undefined}
        level={mcpServerDrilldown ?? 'root'}
      />

      {selectedTools.map((tool, toolIndex) => {
        const isCustomTool = tool.type === 'custom-tool'
        const isMcpTool = tool.type === 'mcp'
        const isAdvancedMcpServer = tool.type === MCP_SERVER_ADVANCED_TOOL_TYPE
        const isMcpFamily = isMcpTool || isAdvancedMcpServer
        const isWorkflowTool = tool.type === 'workflow' || tool.type === 'workflow_input'
        // The unfiltered registry keeps chrome for types the picker hides.
        const toolBlock =
          !isCustomTool && !isMcpFamily
            ? (toolBlocks.find((block) => block.type === tool.type) ?? getBlock(tool.type))
            : undefined

        const hasOperations = !isCustomTool && !isMcpFamily && hasMultipleOperations(toolBlock)
        const operationChoices = hasOperations ? getOperationChoices(toolBlock) : null
        const selectedOperation =
          tool.operation ||
          operationChoices?.options.find((option) => !operationChoices.denied.has(option.id))?.id

        const currentToolId =
          !isCustomTool && !isMcpFamily
            ? getToolIdForOperation(tool.type, selectedOperation, toolBlock) || tool.toolId || ''
            : tool.toolId || ''

        const toolScopedOverrides = scopeCanonicalModesForTool(
          canonicalModeOverrides,
          toolIndex,
          tool.type
        )
        const toolUsageControlMode = getAgentToolUsageControlMode(toolIndex, canonicalModeOverrides)
        const isToolDisabled =
          supportsToolControl &&
          resolveAgentToolUsageControl(tool, toolIndex, canonicalModeOverrides) === 'none'

        const subBlocksResult =
          !isCustomTool && !isMcpFamily && currentToolId
            ? getSubBlocksForToolInput(
                currentToolId,
                tool.type,
                { ...tool.params, operation: selectedOperation },
                toolScopedOverrides,
                toolBlock
              )
            : null

        // canonical-index-unscoped: nested tool params are always the action surface.
        const toolCanonicalIndex = toolBlock?.subBlocks
          ? buildCanonicalIndex(toolBlock.subBlocks)
          : null

        const mcpTool = isMcpTool
          ? mcpTools.find((candidate) => candidate.id === tool.toolId)
          : null
        const advancedMcpServer = isAdvancedMcpServer
          ? mcpServers.find((server) => server.id === tool.params?.serverId)
          : undefined
        const mcpToolSchema = isMcpTool
          ? (mcpToolSchemaOf(tool) ?? mcpTool?.inputSchema)
          : undefined

        // The canonical name wins; the stored title only when nothing resolves.
        const toolDisplayName = isAdvancedMcpServer
          ? (advancedMcpServer?.name ?? 'MCP Server (Advanced)')
          : (resolveStoredToolName(tool, { customTools, mcpToolNamesById }) ?? 'Unknown Tool')

        const displaySubBlocks: SubBlockConfig[] = isMcpFamily
          ? buildSubBlocksFromJsonSchema(
              isAdvancedMcpServer ? ADVANCED_MCP_SERVER_TOOL_SCHEMA : mcpToolSchema,
              isAdvancedMcpServer ? () => 'MCP Server' : formatParameterLabel
            )
          : (subBlocksResult?.subBlocks ?? []).filter(
              (sb) =>
                !sb.reactiveCondition || toolCredential?.type === sb.reactiveCondition.requiredType
            )

        const mcpIssue = isMcpTool ? getMcpToolIssue(tool) : null
        const showToolControl = supportsToolControl && !(isMcpTool && isToolUnavailable(mcpIssue))
        const hasToolBody = showToolControl || hasOperations || displaySubBlocks.length > 0

        const isSearchExpanded =
          activeSearchTarget?.subBlockId === subBlockId &&
          activeSearchTarget.valuePath[0] === toolIndex &&
          (activeSearchTarget.valuePath[1] === 'params' ||
            activeSearchTarget.valuePath[1] === 'usageControlExpression')
        const isExpandedForDisplay = hasToolBody
          ? isPreview || disabled
            ? isSearchExpanded || (localExpanded[toolIndex] ?? Boolean(tool.isExpanded))
            : isSearchExpanded || Boolean(tool.isExpanded)
          : false

        const serverToolCount = isMcpTool
          ? selectedTools.filter(
              (candidate) =>
                candidate.type === 'mcp' && candidate.params?.serverId === tool.params?.serverId
            ).length
          : 0
        const removeButton = (
          <IconButton
            label='Remove tool'
            icon='I105'
            size='compact'
            disabled={isPreview || disabled}
            onClick={(event) => {
              event.stopPropagation()
              handleRemoveTool(toolIndex)
            }}
          />
        )

        const mark = isCustomTool ? (
          <ToolMark glyph='I127' />
        ) : isMcpFamily ? (
          <ToolMark
            glyph='I126'
            artwork={
              mcpTool?.icon ??
              (advancedMcpServer?.managedConnectorId
                ? getManagedMcpConnectorIcon(advancedMcpServer.managedConnectorId)
                : undefined)
            }
          />
        ) : isWorkflowTool ? (
          <ToolMark glyph='I118' />
        ) : (
          <ToolMark blockType={tool.type} fallbackLabel={toolDisplayName.charAt(0)} />
        )

        const renderParam = (sb: SubBlockConfig) => {
          const canonicalId = toolCanonicalIndex?.canonicalIdBySubBlockId[sb.id]
          const canonicalGroup = canonicalId
            ? toolCanonicalIndex?.groupsById[canonicalId]
            : undefined
          const canonicalMode =
            canonicalGroup && isCanonicalPair(canonicalGroup)
              ? resolveCanonicalMode(
                  canonicalGroup,
                  { ...tool.params, operation: selectedOperation },
                  toolScopedOverrides
                )
              : undefined
          const canonicalToggle: CanonicalToggle | undefined =
            canonicalMode && canonicalId
              ? {
                  mode: canonicalMode,
                  onToggle: () =>
                    collaborativeSetBlockCanonicalMode(
                      blockId,
                      `${toolIndex}:${canonicalId}`,
                      canonicalMode === 'advanced' ? 'basic' : 'advanced'
                    ),
                }
              : undefined
          return (
            <ActiveSearchTargetProvider
              key={sb.id}
              value={getParamActiveSearchTarget(
                toolIndex,
                sb.id,
                buildToolSubBlockId(subBlockId, toolIndex, sb.id)
              )}
            >
              <ToolParam
                blockId={blockId}
                subBlockId={subBlockId}
                toolIndex={toolIndex}
                subBlock={sb}
                toolType={tool.type}
                toolParams={tool.params}
                operation={selectedOperation}
                onParamChange={handleParamChange}
                disabled={disabled}
                canonicalToggle={canonicalToggle}
              />
            </ActiveSearchTargetProvider>
          )
        }

        const operationOptions = operationChoices?.options ?? []
        const selectedOperationLabel = operationOptions.find(
          (option) => option.id === selectedOperation
        )?.label

        return (
          <ItemCard
            key={`${tool.customToolId || tool.toolId || toolIndex}-${toolIndex}`}
            mark={mark}
            title={toolDisplayName}
            name={formatDisplayText(toolDisplayName, {
              workflowSearchHighlight: getActiveWorkflowSearchHighlight({
                activeSearchTarget,
                blockId,
                subBlockId,
                valuePath: [toolIndex, 'title'],
              }),
            })}
            badges={
              <>
                {isMcpTool && !mcpDataLoading && mcpIssue && (
                  <McpIssueBadge
                    issue={mcpIssue}
                    onOpenSettings={() => openMcpSettings(tool.params?.serverId)}
                  />
                )}
                {isWorkflowTool && tool.params?.workflowId && (
                  <WorkflowDeployBadge workflowId={tool.params.workflowId} />
                )}
              </>
            }
            actions={
              <>
                {isCustomTool && hasToolBody && (
                  <IconButton
                    label='Edit custom tool'
                    icon='I036'
                    size='compact'
                    onClick={(event) => {
                      event.stopPropagation()
                      handleEditCustomTool(toolIndex)
                    }}
                  />
                )}
                {isMcpTool && serverToolCount > 1 ? (
                  <ContextActionMenu
                    label='Remove tool'
                    actions={[
                      {
                        id: 'remove',
                        label: 'Remove',
                        disabled: isPreview || disabled,
                        onSelect: () => handleRemoveTool(toolIndex),
                      },
                      {
                        id: 'remove-server',
                        label: `Remove all from ${tool.params?.serverName || 'server'}`,
                        disabled: isPreview || disabled,
                        onSelect: () => handleRemoveAllFromServer(tool.params?.serverId),
                      },
                    ]}
                  >
                    {removeButton}
                  </ContextActionMenu>
                ) : (
                  removeButton
                )}
              </>
            }
            expandable={hasToolBody}
            expanded={isExpandedForDisplay}
            onActivate={
              hasToolBody
                ? () => toggleToolExpansion(toolIndex)
                : isCustomTool
                  ? () => handleEditCustomTool(toolIndex)
                  : undefined
            }
            muted={showToolControl && isToolDisabled}
            drag={{
              draggable: selectedTools.length > 1 && !isPreview && !disabled,
              dragging: draggedIndex === toolIndex,
              dropTarget:
                dragOverIndex === toolIndex && draggedIndex !== null && draggedIndex !== toolIndex,
              onDragStart: (event) => handleDragStart(event, toolIndex),
              onDragEnd: handleDragEnd,
              onDragOver: (event) => handleDragOver(event, toolIndex),
              onDrop: (event) => handleDrop(event, toolIndex),
            }}
          >
            {showToolControl && (
              <ToolUsageControl
                blockId={blockId}
                aggregateSubBlockId={subBlockId}
                toolIndex={toolIndex}
                tool={tool}
                mode={toolUsageControlMode}
                supportsForce={supportsForce}
                disabled={disabled || isPreview}
                onFixedChange={(usageControl) => updateTool(toolIndex, { usageControl })}
                onExpressionChange={(usageControlExpression) =>
                  updateTool(toolIndex, { usageControlExpression })
                }
                onModeToggle={() =>
                  collaborativeSetBlockCanonicalMode(
                    blockId,
                    buildAgentToolUsageControlCanonicalKey(toolIndex),
                    toolUsageControlMode === 'advanced' ? 'basic' : 'advanced'
                  )
                }
              />
            )}
            {isAdvancedMcpServer && (
              <McpOperationPolicyEditor
                value={tool.operationPolicy}
                disabled={disabled || isPreview}
                onChange={(operationPolicy) => updateTool(toolIndex, { operationPolicy })}
              />
            )}
            {operationOptions.length > 0 && (
              <SearchableSelect
                label='Operation'
                searchLabel='Search operations'
                placeholder='Select operation'
                options={operationOptions
                  .filter((option) => !operationChoices?.denied.has(option.id))
                  .map((option) => ({ value: option.id, label: option.label }))}
                value={selectedOperation ?? null}
                selectedLabel={selectedOperationLabel}
                onValueChange={(next) => {
                  if (next) handleOperationChange(toolIndex, next)
                }}
                // Denied operations drop out only once the config resolves, and picking one
                // rewrites the stored tool.
                disabled={disabled || isPermissionLoading}
              />
            )}
            {displaySubBlocks.map(renderParam)}
          </ItemCard>
        )
      })}

      <CustomToolModal
        open={customToolModalOpen}
        onOpenChange={(next) => {
          setCustomToolModalOpen(next)
          if (!next) setEditingToolIndex(null)
        }}
        onSave={editingToolIndex !== null ? handleSaveCustomTool : handleAddCustomTool}
        onDelete={handleDeleteTool}
        blockId={blockId}
        initialValues={customToolInitialValues}
      />

      <McpServerFormModal
        open={mcpModalOpen}
        onOpenChange={setMcpModalOpen}
        mode='add'
        onSubmit={async (config: McpServerFormConfig) => {
          const result = await createMcpServer.mutateAsync({
            workspaceId,
            config: { ...config, enabled: true },
          })
          if (result.authType === 'oauth') await startOauthForServer(result.serverId)
        }}
        workspaceId={workspaceId}
        availableEnvVars={availableEnvVars}
        allowedMcpDomains={allowedMcpDomains}
      />
    </div>
  )
})
