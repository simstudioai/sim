import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { SubBlockRowView, WorkflowBlockView } from '@sim/workflow-renderer'
import { isEqual } from 'es-toolkit'
import { useParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { type NodeProps, useUpdateNodeInternals } from 'reactflow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createMcpToolId } from '@/lib/mcp/shared'
import { sendMothershipMessage } from '@/lib/mothership/events'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import { captureEvent } from '@/lib/posthog/client'
import { calculateWorkflowBlockDimensions } from '@/lib/workflows/blocks/deterministic-dimensions'
import { getConditionRows, getRouterRows } from '@/lib/workflows/dynamic-handle-topology'
import {
  getDisplayValue,
  resolveDropdownLabel,
  resolveFilterFieldLabel,
  resolveSkillsLabel,
  resolveToolsLabel,
  resolveVariablesLabel,
  resolveWorkflowMultiSelectLabel,
  resolveWorkflowSelectionLabel,
} from '@/lib/workflows/subblocks/display'
import {
  buildCanonicalIndex,
  evaluateSubBlockCondition,
  hasAdvancedValues,
  isSubBlockFeatureEnabled,
  isSubBlockHidden,
  isSubBlockVisibleForMode,
  isTriggerModeSubBlock,
  resolveDependencyValue,
} from '@/lib/workflows/subblocks/visibility'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ActionBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/action-bar'
import {
  useBlockProperties,
  useChildWorkflow,
  useWebhookInfo,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/hooks'
import type { WorkflowBlockProps } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/types'
import {
  getProviderName,
  shouldSkipBlockRender,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/utils'
import { useBlockVisual } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useBlockDimensions } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-block-dimensions'
import { useCustomBlockOverlayVersion } from '@/blocks/custom/client-overlay'
import { getBlock } from '@/blocks/registry'
import {
  type BlockConfig,
  SELECTOR_TYPES_HYDRATION_REQUIRED,
  type SubBlockConfig,
} from '@/blocks/types'
import { getDependsOnFields } from '@/blocks/utils'
import { useKnowledgeBase } from '@/hooks/kb/use-knowledge'
import { useCustomTools } from '@/hooks/queries/custom-tools'
import { useDeployWorkflow } from '@/hooks/queries/deployments'
import { useMcpServers, useMcpToolsQuery } from '@/hooks/queries/mcp'
import { useCredentialName } from '@/hooks/queries/oauth/oauth-credentials'
import { useReactivateSchedule, useScheduleInfo } from '@/hooks/queries/schedules'
import { useSkills } from '@/hooks/queries/skills'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflowMap } from '@/hooks/queries/workflows'
import { useReactiveConditions } from '@/hooks/use-reactive-conditions'
import { useSelectorDisplayName } from '@/hooks/use-selector-display-name'
import { getModelSunsetStatus } from '@/providers/models'
import { useVariablesStore } from '@/stores/variables/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { wouldCreateCycle } from '@/stores/workflows/workflow/utils'
import { formatParameterLabel } from '@/tools/params'

const logger = createLogger('WorkflowBlock')

/** Stable empty object to avoid creating new references */
const EMPTY_SUBBLOCK_VALUES = {} as Record<string, any>

/** Stable empty map for rows that never resolve MCP tool names */
const EMPTY_MCP_TOOL_NAMES: ReadonlyMap<string, string> = new Map()

interface BlockSunset {
  status: 'legacy' | 'deprecated'
  kind: 'block' | 'model'
  tooltip: string
  prompt: string
}

/** Instruction for the agent to migrate a block instance to its successor. */
function migrationPrompt(name: string, target: BlockConfig): string {
  return `Migrate the "${name}" block to the current ${target.name} block: change the block type, then set the new block's required inputs as a separate edit (inputs are validated against the old type when sent in the same edit), or delete it and re-add ${target.name} and rewire the connections.`
}

/**
 * Sunset state for a placed block: the block type itself (via `config.sunset`)
 * or its selected model. `legacy` (amber) is superseded-but-supported and needs
 * a resolvable successor; `deprecated` (red) is no longer supported and badges
 * with or without one. `null` when neither applies or in diff mode.
 */
function getBlockSunset(
  config: BlockConfig,
  name: string,
  model: unknown,
  isDiffMode: boolean
): BlockSunset | null {
  if (isDiffMode) return null

  const sunset = config.sunset
  if (sunset) {
    const target = sunset.replacedBy ? getBlock(sunset.replacedBy) : undefined

    if (sunset.status === 'legacy') {
      if (!target) return null
      const hasModel = config.subBlocks?.some((sub) => sub.id === 'model')
      return {
        status: 'legacy',
        kind: 'block',
        tooltip: 'This is a legacy block. Click to upgrade',
        prompt: `The "${name}" block is legacy. ${migrationPrompt(name, target)}${hasModel ? ' Also pick a current, non-deprecated model.' : ''}`,
      }
    }

    return {
      status: 'deprecated',
      kind: 'block',
      tooltip: 'This block is no longer supported. Click to replace',
      prompt: target
        ? `The "${name}" block is no longer supported. ${migrationPrompt(name, target)}`
        : `The "${name}" block is no longer supported and has no direct successor. Replace it with current blocks that achieve the same result and rewire the connections.`,
    }
  }

  if (typeof model === 'string') {
    const modelStatus = getModelSunsetStatus(model)
    if (modelStatus === 'deprecated') {
      return {
        status: 'deprecated',
        kind: 'model',
        tooltip: `${model} is no longer available. Click to switch models`,
        prompt: `The "${name}" block uses "${model}", which the provider has retired — calls to it now fail. Switch it to the latest equivalent model.`,
      }
    }
    if (modelStatus === 'legacy') {
      return {
        status: 'legacy',
        kind: 'model',
        tooltip: `${model} is deprecated. Click to upgrade`,
        prompt: `The "${name}" block uses the deprecated model "${model}". Switch it to the latest equivalent model.`,
      }
    }
  }

  return null
}

interface SubBlockRowProps {
  title: string
  value?: string
  subBlock?: SubBlockConfig
  rawValue?: unknown
  workspaceId?: string
  workflowId?: string
  blockId?: string
  allSubBlockValues?: Record<string, { value: unknown }>
  displayAdvancedOptions?: boolean
  canonicalIndex?: ReturnType<typeof buildCanonicalIndex>
  canonicalModeOverrides?: Record<string, 'basic' | 'advanced'>
}

/**
 * Compares SubBlockRow props for memo equality check.
 */
const areSubBlockRowPropsEqual = (
  prevProps: SubBlockRowProps,
  nextProps: SubBlockRowProps
): boolean => {
  const subBlockId = prevProps.subBlock?.id
  const prevValue = subBlockId ? prevProps.allSubBlockValues?.[subBlockId]?.value : undefined
  const nextValue = subBlockId ? nextProps.allSubBlockValues?.[subBlockId]?.value : undefined
  const valueEqual = prevValue === nextValue || isEqual(prevValue, nextValue)

  return (
    prevProps.title === nextProps.title &&
    prevProps.value === nextProps.value &&
    prevProps.subBlock === nextProps.subBlock &&
    prevProps.rawValue === nextProps.rawValue &&
    prevProps.workspaceId === nextProps.workspaceId &&
    prevProps.workflowId === nextProps.workflowId &&
    prevProps.blockId === nextProps.blockId &&
    valueEqual &&
    prevProps.displayAdvancedOptions === nextProps.displayAdvancedOptions &&
    prevProps.canonicalIndex === nextProps.canonicalIndex &&
    prevProps.canonicalModeOverrides === nextProps.canonicalModeOverrides
  )
}

/**
 * Renders a single subblock row with title and optional value.
 * Automatically hydrates IDs to display names for all selector types.
 * Memoized to prevent excessive re-renders when parent components update.
 */
const SubBlockRow = memo(function SubBlockRow({
  title,
  value,
  subBlock,
  rawValue,
  workspaceId,
  workflowId,
  blockId,
  allSubBlockValues,
  displayAdvancedOptions,
  canonicalIndex,
  canonicalModeOverrides,
}: SubBlockRowProps) {
  const getStringValue = useCallback(
    (key?: string): string | undefined => {
      if (!key || !allSubBlockValues) return undefined
      const candidate = allSubBlockValues[key]?.value
      return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined
    },
    [allSubBlockValues]
  )

  const rawValues = useMemo(() => {
    if (!allSubBlockValues) return {}
    return Object.entries(allSubBlockValues).reduce<Record<string, unknown>>(
      (acc, [key, entry]) => {
        acc[key] = entry?.value
        return acc
      },
      {}
    )
  }, [allSubBlockValues])

  const dependencyValues = useMemo(() => {
    const fields = getDependsOnFields(subBlock?.dependsOn)
    if (!fields.length) return {}
    return fields.reduce<Record<string, string>>((accumulator, dependency) => {
      const dependencyValue = resolveDependencyValue(
        dependency,
        rawValues,
        canonicalIndex || buildCanonicalIndex([]),
        canonicalModeOverrides
      )
      const dependencyString =
        typeof dependencyValue === 'string' && dependencyValue.length > 0
          ? dependencyValue
          : undefined
      if (dependencyString) {
        accumulator[dependency] = dependencyString
      }
      return accumulator
    }, {})
  }, [
    canonicalIndex,
    canonicalModeOverrides,
    displayAdvancedOptions,
    rawValues,
    subBlock?.dependsOn,
  ])

  const credentialSourceId =
    subBlock?.type === 'oauth-input' && typeof rawValue === 'string' ? rawValue : undefined
  const credentialProviderId = subBlock?.serviceId
    ? getProviderIdFromServiceId(subBlock.serviceId)
    : undefined
  const { displayName: credentialName } = useCredentialName(
    credentialSourceId,
    credentialProviderId,
    workflowId,
    workspaceId
  )

  const knowledgeBaseId = dependencyValues.knowledgeBaseId

  const dropdownLabel = useMemo(
    () => resolveDropdownLabel(subBlock, rawValue),
    [subBlock, rawValue]
  )

  const resolveContextValue = useCallback(
    (key: string): string | undefined => {
      const resolved = resolveDependencyValue(
        key,
        rawValues,
        canonicalIndex || buildCanonicalIndex([]),
        canonicalModeOverrides
      )
      return typeof resolved === 'string' && resolved.length > 0 ? resolved : undefined
    },
    [rawValues, canonicalIndex, canonicalModeOverrides]
  )

  const domainValue = resolveContextValue('domain')
  const teamIdValue = resolveContextValue('teamId')
  const projectIdValue = resolveContextValue('projectId')
  const planIdValue = resolveContextValue('planId')
  const baseIdValue = resolveContextValue('baseId')
  const datasetIdValue = resolveContextValue('datasetId')
  const serviceDeskIdValue = resolveContextValue('serviceDeskId')
  const siteIdValue = resolveContextValue('siteId')
  const collectionIdValue = resolveContextValue('collectionId')
  const spreadsheetIdValue = resolveContextValue('spreadsheetId')
  const fileIdValue = resolveContextValue('fileId')
  const credentialId = dependencyValues.credential ?? resolveContextValue('oauthCredential')

  const { displayName: selectorDisplayName } = useSelectorDisplayName({
    subBlock,
    value: rawValue,
    workflowId,
    oauthCredential: typeof credentialId === 'string' ? credentialId : undefined,
    knowledgeBaseId: typeof knowledgeBaseId === 'string' ? knowledgeBaseId : undefined,
    domain: domainValue,
    teamId: teamIdValue,
    projectId: projectIdValue,
    planId: planIdValue,
    baseId: baseIdValue,
    datasetId: datasetIdValue,
    serviceDeskId: serviceDeskIdValue,
    siteId: siteIdValue,
    collectionId: collectionIdValue,
    spreadsheetId: spreadsheetIdValue,
    fileId: fileIdValue,
  })

  const { knowledgeBase: kbForDisplayName } = useKnowledgeBase(
    subBlock?.type === 'knowledge-base-selector' && typeof rawValue === 'string' ? rawValue : ''
  )
  const knowledgeBaseDisplayName = kbForDisplayName?.name ?? null

  const {
    data: workflowMapForLookup = {},
    isSuccess: workflowMapLoaded,
    isPlaceholderData: workflowMapIsPlaceholder,
  } = useWorkflowMap(workspaceId)
  /**
   * Hydrates workflow-selector values and multi-select workflow dropdowns to
   * names. Ready only on a successful, non-placeholder load — an errored or
   * stale-placeholder map must not mislabel valid workflows as deleted.
   */
  const workflowSelectionName = useMemo(() => {
    const lookup = {
      workflowMap: workflowMapForLookup,
      ready: workflowMapLoaded && !workflowMapIsPlaceholder,
    }
    return (
      resolveWorkflowSelectionLabel(subBlock, rawValue, lookup) ??
      resolveWorkflowMultiSelectLabel(subBlock, rawValue, lookup)
    )
  }, [workflowMapForLookup, workflowMapLoaded, workflowMapIsPlaceholder, subBlock, rawValue])

  const { data: mcpServers = [] } = useMcpServers(workspaceId || '')
  const mcpServerDisplayName = useMemo(() => {
    if (subBlock?.type !== 'mcp-server-selector' || typeof rawValue !== 'string') {
      return null
    }
    const server = mcpServers.find((s) => s.id === rawValue)
    return server?.name ?? null
  }, [subBlock?.type, rawValue, mcpServers])

  const { data: mcpToolsData = [] } = useMcpToolsQuery(workspaceId || '')
  const mcpToolNamesById = useMemo(() => {
    if (subBlock?.type !== 'mcp-tool-selector' && subBlock?.type !== 'tool-input') {
      return EMPTY_MCP_TOOL_NAMES
    }
    const names = new Map<string, string>()
    for (const t of mcpToolsData) {
      const toolId = createMcpToolId(t.serverId, t.name)
      if (!names.has(toolId)) names.set(toolId, t.name)
    }
    return names
  }, [subBlock?.type, mcpToolsData])
  const mcpToolDisplayName = useMemo(() => {
    if (subBlock?.type !== 'mcp-tool-selector' || typeof rawValue !== 'string') {
      return null
    }
    return mcpToolNamesById.get(rawValue) ?? null
  }, [subBlock?.type, rawValue, mcpToolNamesById])

  const { data: tables = [] } = useTablesList(workspaceId || '')
  const tableDisplayName = useMemo(() => {
    if (subBlock?.type !== 'table-selector' || typeof rawValue !== 'string') {
      return null
    }
    const table = tables.find((t) => t.id === rawValue)
    return table?.name ?? null
  }, [subBlock?.type, rawValue, tables])

  const webhookUrlDisplayValue = useMemo(() => {
    if (!subBlock?.id?.startsWith('webhookUrlDisplay') || !blockId) {
      return null
    }
    const baseUrl = getBaseUrl()
    const triggerPath = allSubBlockValues?.triggerPath?.value as string | undefined
    return triggerPath
      ? `${baseUrl}/api/webhooks/trigger/${triggerPath}`
      : `${baseUrl}/api/webhooks/trigger/${blockId}`
  }, [subBlock?.id, blockId, allSubBlockValues])

  /**
   * Subscribe only to variables for this workflow to avoid re-renders from other workflows.
   * Uses isEqual for deep comparison since Object.fromEntries creates a new object each time.
   */
  const workflowVariables = useStoreWithEqualityFn(
    useVariablesStore,
    useCallback(
      (state) => {
        if (!workflowId) return {}
        return Object.fromEntries(
          Object.entries(state.variables).filter(([, v]) => v.workflowId === workflowId)
        )
      },
      [workflowId]
    ),
    isEqual
  )

  const variablesDisplayValue = useMemo(
    () => resolveVariablesLabel(subBlock, rawValue, Object.values(workflowVariables)),
    [subBlock, rawValue, workflowVariables]
  )

  /**
   * Hydrates tool references to display names. The overlay version is a dep
   * because resolveToolsLabel reads getBlock, whose custom-block results
   * change when the client overlay hydrates (see client-overlay.ts).
   */
  const { data: customTools = [] } = useCustomTools(workspaceId || '')
  const customBlockOverlayVersion = useCustomBlockOverlayVersion()
  const toolsDisplayValue = useMemo(
    () => resolveToolsLabel(subBlock, rawValue, customTools, mcpToolNamesById),
    [subBlock, rawValue, customTools, mcpToolNamesById, customBlockOverlayVersion]
  )

  const filterDisplayValue = useMemo(
    () => resolveFilterFieldLabel(subBlock, rawValue),
    [subBlock, rawValue]
  )

  /** Hydrates skill references to display names. */
  const { data: workspaceSkills = [] } = useSkills(workspaceId || '')
  const skillsDisplayValue = useMemo(
    () => resolveSkillsLabel(subBlock, rawValue, workspaceSkills),
    [subBlock, rawValue, workspaceSkills]
  )

  const isPasswordField = subBlock?.password === true
  const maskedValue = isPasswordField && value && value !== '-' ? '•••' : null
  const isMonospaceField = Boolean(filterDisplayValue)

  const isSelectorType = subBlock?.type && SELECTOR_TYPES_HYDRATION_REQUIRED.includes(subBlock.type)
  const hydratedName =
    credentialName ||
    dropdownLabel ||
    variablesDisplayValue ||
    filterDisplayValue ||
    toolsDisplayValue ||
    skillsDisplayValue ||
    knowledgeBaseDisplayName ||
    workflowSelectionName ||
    mcpServerDisplayName ||
    mcpToolDisplayName ||
    tableDisplayName ||
    webhookUrlDisplayValue ||
    selectorDisplayName
  const displayValue = maskedValue || hydratedName || (isSelectorType && value ? '-' : value)

  return (
    <SubBlockRowView title={title} displayValue={displayValue} isMonospace={isMonospaceField} />
  )
}, areSubBlockRowPropsEqual)

export const WorkflowBlock = memo(function WorkflowBlock({
  id,
  data,
  selected,
}: NodeProps<WorkflowBlockProps>) {
  const { type, config, name, isPending } = data

  const contentRef = useRef<HTMLDivElement>(null)

  const params = useParams()
  const workspaceId = params.workspaceId as string

  const {
    currentWorkflow,
    activeWorkflowId,
    isEnabled,
    isLocked,
    handleClick,
    hasRing,
    ringStyles,
    runPathStatus,
  } = useBlockVisual({ blockId: id, data, isPending, isSelected: selected })

  const currentWorkflowId = (params.workflowId as string) || activeWorkflowId || ''

  const currentBlock = currentWorkflow.getBlockById(id)

  const { horizontalHandles, blockHeight, blockWidth, displayAdvancedMode, displayTriggerMode } =
    useBlockProperties(
      id,
      currentWorkflow.isDiffMode,
      data.isPreview ?? false,
      data.blockState,
      currentWorkflow.blocks
    )

  const {
    isWebhookConfigured,
    webhookProvider,
    webhookPath,
    isDisabled: isWebhookDisabled,
    webhookId,
    reactivateWebhook,
  } = useWebhookInfo(id, currentWorkflowId)

  const { scheduleInfo, isLoading: isLoadingScheduleInfo } = useScheduleInfo(
    currentWorkflowId,
    id,
    type
  )
  const reactivateScheduleMutation = useReactivateSchedule()
  const reactivateSchedule = useCallback(
    async (scheduleId: string) => {
      await reactivateScheduleMutation.mutateAsync({
        scheduleId,
        workflowId: currentWorkflowId,
        blockId: id,
      })
    },
    [reactivateScheduleMutation, currentWorkflowId, id]
  )

  const { childWorkflowId, childIsDeployed, childNeedsRedeploy } = useChildWorkflow(
    id,
    type,
    data.isPreview ?? false,
    data.subBlockValues
  )

  const { mutate: deployChildWorkflow, isPending: isDeploying } = useDeployWorkflow()

  const userPermissions = useUserPermissionsContext()
  const canEditWorkflow = userPermissions.canEdit && !data.isWorkflowLocked

  const currentStoreBlock = currentWorkflow.getBlockById(id)

  const isStarterBlock = type === 'starter'
  const isWebhookTriggerBlock = type === 'webhook' || type === 'generic_webhook'

  const blockSubBlockValues = useStoreWithEqualityFn(
    useSubBlockStore,
    useCallback(
      (state) => {
        if (!activeWorkflowId) return EMPTY_SUBBLOCK_VALUES
        return state.workflowValues[activeWorkflowId]?.[id] ?? EMPTY_SUBBLOCK_VALUES
      },
      [activeWorkflowId, id]
    ),
    isEqual
  )

  const posthog = usePostHog()

  const sunset = getBlockSunset(config, name, blockSubBlockValues.model, currentWorkflow.isDiffMode)

  const onFixSunset = () => {
    if (!sunset) return
    captureEvent(posthog, 'deprecated_block_fix_clicked', {
      block_type: type,
      workflow_id: currentWorkflowId,
      kind: sunset.kind,
    })
    sendMothershipMessage(sunset.prompt, [
      { kind: 'workflow_block', workflowId: currentWorkflowId, blockId: id, label: name },
    ])
  }

  const canonicalIndex = useMemo(() => buildCanonicalIndex(config.subBlocks), [config.subBlocks])
  const canonicalModeOverrides = currentStoreBlock?.data?.canonicalModes

  const hiddenByReactiveCondition = useReactiveConditions(
    config.subBlocks,
    id,
    activeWorkflowId,
    canonicalModeOverrides
  )

  const subBlockRowsData = useMemo(() => {
    const rows: SubBlockConfig[][] = []
    let currentRow: SubBlockConfig[] = []
    let currentRowWidth = 0

    /**
     * Get the appropriate state for conditional evaluation based on the current mode.
     * Uses preview values in preview mode, diff workflow values in diff mode,
     * or the current block's subblock values otherwise.
     */
    const stateToUse: Record<string, { value: unknown }> =
      data.isPreview && data.subBlockValues
        ? data.subBlockValues
        : Object.entries(blockSubBlockValues).reduce(
            (acc, [key, value]) => {
              acc[key] = { value }
              return acc
            },
            {} as Record<string, { value: unknown }>
          )

    const rawValues = Object.entries(stateToUse).reduce<Record<string, unknown>>(
      (acc, [key, entry]) => {
        acc[key] = entry?.value
        return acc
      },
      {}
    )

    const effectiveAdvanced = canEditWorkflow
      ? displayAdvancedMode
      : displayAdvancedMode || hasAdvancedValues(config.subBlocks, rawValues, canonicalIndex)
    const effectiveTrigger = displayTriggerMode

    const visibleSubBlocks = config.subBlocks.filter((block) => {
      if (block.hidden) return false
      if (block.hideFromPreview) return false
      if (hiddenByReactiveCondition.has(block.id)) return false
      if (!isSubBlockFeatureEnabled(block)) return false
      if (isSubBlockHidden(block)) return false

      const isPureTriggerBlock = config?.triggers?.enabled && config.category === 'triggers'

      if (effectiveTrigger) {
        const isValidTriggerSubblock = isPureTriggerBlock
          ? isTriggerModeSubBlock(block) || !block.mode
          : isTriggerModeSubBlock(block)

        if (!isValidTriggerSubblock) {
          return false
        }
      } else {
        if (isTriggerModeSubBlock(block)) {
          return false
        }
      }

      if (
        !isSubBlockVisibleForMode(
          block,
          effectiveAdvanced,
          canonicalIndex,
          rawValues,
          canonicalModeOverrides
        )
      ) {
        return false
      }

      if (!block.condition) return true

      return evaluateSubBlockCondition(block.condition, rawValues)
    })

    visibleSubBlocks.forEach((block) => {
      if (currentRowWidth + blockWidth > 1) {
        if (currentRow.length > 0) {
          rows.push([...currentRow])
        }
        currentRow = [block]
        currentRowWidth = blockWidth
      } else {
        currentRow.push(block)
        currentRowWidth += blockWidth
      }
    })

    if (currentRow.length > 0) {
      rows.push(currentRow)
    }

    return { rows, stateToUse }
  }, [
    config.subBlocks,
    config.category,
    config.triggers,
    id,
    displayAdvancedMode,
    displayTriggerMode,
    data.isPreview,
    data.subBlockValues,
    currentWorkflow.isDiffMode,
    currentBlock,
    canonicalModeOverrides,
    canEditWorkflow,
    canonicalIndex,
    hiddenByReactiveCondition,
    blockSubBlockValues,
    activeWorkflowId,
  ])

  const subBlockRows = subBlockRowsData.rows
  const subBlockState = subBlockRowsData.stateToUse
  const topologySubBlocks = data.isPreview
    ? (data.blockState?.subBlocks ?? {})
    : (currentStoreBlock?.subBlocks ?? {})
  const effectiveAdvanced = useMemo(() => {
    const rawValues = Object.entries(subBlockState).reduce<Record<string, unknown>>(
      (acc, [key, entry]) => {
        acc[key] = entry?.value
        return acc
      },
      {}
    )
    return canEditWorkflow
      ? displayAdvancedMode
      : displayAdvancedMode || hasAdvancedValues(config.subBlocks, rawValues, canonicalIndex)
  }, [subBlockState, displayAdvancedMode, config.subBlocks, canonicalIndex, canEditWorkflow])

  /**
   * Determine if block has content below the header (subblocks or error row).
   * Controls header border visibility and content container rendering.
   */
  const shouldShowDefaultHandles =
    config.category !== 'triggers' && type !== 'starter' && !displayTriggerMode
  const hasContentBelowHeader = subBlockRows.length > 0 || shouldShowDefaultHandles

  /**
   * Compute per-condition rows (title/value/id) for condition blocks so we can render
   * one row per condition statement with its own output handle.
   */
  const conditionRows = useMemo(() => {
    if (type !== 'condition') return [] as { id: string; title: string; value: string }[]
    return getConditionRows(id, topologySubBlocks.conditions?.value).map((cond) => ({
      ...cond,
      value: getDisplayValue(cond.value),
    }))
  }, [type, topologySubBlocks, id])

  /**
   * Compute per-route rows (id/value) for router_v2 blocks so we can render
   * one row per route with its own output handle.
   * Uses same structure as conditions: { id, title, value }
   */
  const routerRows = useMemo(() => {
    if (type !== 'router_v2') return [] as { id: string; value: string }[]
    return getRouterRows(id, topologySubBlocks.routes?.value).map((route) => ({
      ...route,
      value: getDisplayValue(route.value),
    }))
  }, [type, topologySubBlocks, id])

  /**
   * Total rendered row count. `mcp-dynamic-args` expands one row per parameter
   * in the cached tool schema, so we count those properties instead of 1.
   */
  const totalRenderedRowCount = useMemo(() => {
    let count = 0
    for (const row of subBlockRows) {
      for (const subBlock of row) {
        if (subBlock.type === 'mcp-dynamic-args') {
          const schema = subBlockState._toolSchema?.value as
            | { properties?: Record<string, unknown> }
            | undefined
          const properties = schema?.properties
          count += properties && typeof properties === 'object' ? Object.keys(properties).length : 0
        } else {
          count += 1
        }
      }
    }
    return count
  }, [subBlockRows, subBlockState])

  /**
   * Compute and publish deterministic layout metrics for workflow blocks.
   * This avoids ResizeObserver/animation-frame jitter and prevents initial "jump".
   */
  useBlockDimensions({
    blockId: id,
    calculateDimensions: () => {
      return calculateWorkflowBlockDimensions({
        blockType: type,
        category: config.category,
        displayTriggerMode,
        visibleSubBlockCount: totalRenderedRowCount,
        conditionRowCount: conditionRows.length,
        routerRowCount: routerRows.length,
      })
    },
    dependencies: [
      type,
      config.category,
      displayTriggerMode,
      totalRenderedRowCount,
      conditionRows.length,
      routerRows.length,
      horizontalHandles,
    ],
  })

  /**
   * Notify React Flow when handle orientation changes so it can recalculate edge paths.
   * This is necessary because toggling handles doesn't change block dimensions,
   * so useBlockDimensions won't trigger updateNodeInternals.
   */
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [horizontalHandles, id, updateNodeInternals])

  const showWebhookIndicator = (isStarterBlock || isWebhookTriggerBlock) && isWebhookConfigured
  const shouldShowScheduleBadge =
    type === 'schedule' && !isLoadingScheduleInfo && scheduleInfo !== null
  const isWorkflowSelector = type === 'workflow' || type === 'workflow_input'

  const wouldCreateConnectionCycle = (source: string, target: string) =>
    wouldCreateCycle(useWorkflowStore.getState().edges, source, target)

  const webhookProviderName = webhookProvider ? getProviderName(webhookProvider) : undefined

  const rows =
    type === 'condition' || type === 'router_v2' ? null : (
      <>
        {subBlockRows.map((row, rowIndex) =>
          row.flatMap((subBlock) => {
            const rawValue = subBlockState[subBlock.id]?.value
            if (subBlock.type === 'mcp-dynamic-args') {
              const schema = subBlockState._toolSchema?.value as
                | { properties?: Record<string, unknown> }
                | undefined
              const properties = schema?.properties
              if (properties && typeof properties === 'object') {
                const args = (rawValue && typeof rawValue === 'object' ? rawValue : {}) as Record<
                  string,
                  unknown
                >
                return Object.keys(properties).map((paramName) => (
                  <SubBlockRow
                    key={`${subBlock.id}-${paramName}-${rowIndex}`}
                    title={formatParameterLabel(paramName)}
                    value={getDisplayValue(args[paramName])}
                  />
                ))
              }
              return []
            }
            return [
              <SubBlockRow
                key={`${subBlock.id}-${rowIndex}`}
                title={subBlock.title ?? subBlock.id}
                value={getDisplayValue(rawValue)}
                subBlock={subBlock}
                rawValue={rawValue}
                workspaceId={workspaceId}
                workflowId={currentWorkflowId}
                blockId={id}
                allSubBlockValues={subBlockState}
                displayAdvancedOptions={effectiveAdvanced}
                canonicalIndex={canonicalIndex}
                canonicalModeOverrides={canonicalModeOverrides}
              />,
            ]
          })
        )}
      </>
    )

  return (
    <WorkflowBlockView
      id={id}
      type={type}
      name={name}
      isPending={isPending}
      isEnabled={isEnabled}
      isLocked={isLocked}
      hasRing={hasRing}
      ringStyles={ringStyles}
      runPathStatus={runPathStatus}
      Icon={config.icon}
      iconBgColor={config.bgColor}
      horizontalHandles={horizontalHandles}
      shouldShowDefaultHandles={shouldShowDefaultHandles}
      hasContentBelowHeader={hasContentBelowHeader}
      conditionRows={conditionRows}
      routerRows={routerRows}
      routerContextValue={getDisplayValue(subBlockState.context?.value)}
      wouldCreateConnectionCycle={wouldCreateConnectionCycle}
      isWorkflowSelector={isWorkflowSelector}
      childWorkflowId={childWorkflowId}
      childIsDeployed={childIsDeployed}
      childNeedsRedeploy={childNeedsRedeploy}
      isDeploying={isDeploying}
      canAdmin={userPermissions.canAdmin}
      onDeployChild={() => {
        if (childWorkflowId && !isDeploying && userPermissions.canAdmin) {
          deployChildWorkflow({ workflowId: childWorkflowId })
        }
      }}
      sunsetStatus={sunset?.status}
      sunsetTooltip={sunset?.tooltip}
      canFixSunset={canEditWorkflow}
      onFixSunset={onFixSunset}
      shouldShowScheduleBadge={shouldShowScheduleBadge}
      scheduleIsDisabled={Boolean(scheduleInfo?.isDisabled)}
      onReactivateSchedule={() => {
        if (scheduleInfo?.id) {
          reactivateSchedule(scheduleInfo.id)
        }
      }}
      showWebhookIndicator={showWebhookIndicator}
      webhookProvider={webhookProvider}
      webhookPath={webhookPath}
      webhookProviderName={webhookProviderName}
      isWebhookConfigured={isWebhookConfigured}
      isWebhookDisabled={isWebhookDisabled}
      webhookId={webhookId}
      onReactivateWebhook={() => {
        if (webhookId) {
          reactivateWebhook(webhookId)
        }
      }}
      onSelect={handleClick}
      contentRef={contentRef}
      actionBar={
        !data.isPreview && !data.isEmbedded ? (
          <ActionBar blockId={id} blockType={type} disabled={!canEditWorkflow} />
        ) : undefined
      }
      rows={rows}
    />
  )
}, shouldSkipBlockRender)
