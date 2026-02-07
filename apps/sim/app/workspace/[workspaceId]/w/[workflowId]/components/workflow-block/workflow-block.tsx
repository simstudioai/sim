import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { isEqual } from 'lodash'
import { useParams } from 'next/navigation'
import { Handle, type NodeProps, Position, useUpdateNodeInternals } from 'reactflow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { Badge, Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createMcpToolId } from '@/lib/mcp/shared'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import { BLOCK_DIMENSIONS, HANDLE_POSITIONS } from '@/lib/workflows/blocks/block-dimensions'
import {
  buildCanonicalIndex,
  evaluateSubBlockCondition,
  hasAdvancedValues,
  isSubBlockFeatureEnabled,
  isSubBlockVisibleForMode,
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
import { getBlock } from '@/blocks'
import { SELECTOR_TYPES_HYDRATION_REQUIRED, type SubBlockConfig } from '@/blocks/types'
import { getDependsOnFields } from '@/blocks/utils'
import { useKnowledgeBase } from '@/hooks/kb/use-knowledge'
import { useCustomTools } from '@/hooks/queries/custom-tools'
import { useMcpServers, useMcpToolsQuery } from '@/hooks/queries/mcp'
import { useCredentialName } from '@/hooks/queries/oauth-credentials'
import { useReactivateSchedule, useScheduleInfo } from '@/hooks/queries/schedules'
import { useSkills } from '@/hooks/queries/skills'
import { useDeployChildWorkflow } from '@/hooks/queries/workflows'
import { useSelectorDisplayName } from '@/hooks/use-selector-display-name'
import { useVariablesStore } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { wouldCreateCycle } from '@/stores/workflows/workflow/utils'

const logger = createLogger('WorkflowBlock')

/** Stable empty object to avoid creating new references */
const EMPTY_SUBBLOCK_VALUES = {} as Record<string, any>

/**
 * Type guard for table row structure
 */
interface TableRow {
  id: string
  cells: Record<string, string>
}

/**
 * Type guard for field format structure (input format, response format)
 */
interface FieldFormat {
  id: string
  name: string
  type?: string
  value?: string
  collapsed?: boolean
}

/**
 * Checks if a value is a table row array
 */
const isTableRowArray = (value: unknown): value is TableRow[] => {
  if (!Array.isArray(value) || value.length === 0) return false
  const firstItem = value[0]
  return (
    typeof firstItem === 'object' &&
    firstItem !== null &&
    'id' in firstItem &&
    'cells' in firstItem &&
    typeof firstItem.cells === 'object'
  )
}

/**
 * Checks if a value is a field format array
 */
const isFieldFormatArray = (value: unknown): value is FieldFormat[] => {
  if (!Array.isArray(value) || value.length === 0) return false
  const firstItem = value[0]
  return (
    typeof firstItem === 'object' && firstItem !== null && 'id' in firstItem && 'name' in firstItem
  )
}

/**
 * Checks if a value is a plain object (not array, not null)
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Type guard for variable assignments array
 */
const isVariableAssignmentsArray = (
  value: unknown
): value is Array<{ id?: string; variableId?: string; variableName?: string; value: any }> => {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        ('variableName' in item || 'variableId' in item)
    )
  )
}

/**
 * Type guard for agent messages array
 */
const isMessagesArray = (value: unknown): value is Array<{ role: string; content: string }> => {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        'role' in item &&
        'content' in item &&
        typeof item.role === 'string' &&
        typeof item.content === 'string'
    )
  )
}

/**
 * Type guard for tag filter array (used in knowledge block filters)
 */
interface TagFilterItem {
  id: string
  tagName: string
  fieldType?: string
  operator?: string
  tagValue: string
}

const isTagFilterArray = (value: unknown): value is TagFilterItem[] => {
  if (!Array.isArray(value) || value.length === 0) return false
  const firstItem = value[0]
  return (
    typeof firstItem === 'object' &&
    firstItem !== null &&
    'tagName' in firstItem &&
    'tagValue' in firstItem
  )
}

/**
 * Type guard for document tag entry array (used in knowledge block create document)
 */
interface DocumentTagItem {
  id: string
  tagName: string
  fieldType?: string
  value: string
}

const isDocumentTagArray = (value: unknown): value is DocumentTagItem[] => {
  if (!Array.isArray(value) || value.length === 0) return false
  const firstItem = value[0]
  return (
    typeof firstItem === 'object' &&
    firstItem !== null &&
    'tagName' in firstItem &&
    'value' in firstItem &&
    !('tagValue' in firstItem) // Distinguish from tag filters
  )
}

/**
 * Attempts to parse a JSON string, returns the parsed value or the original value if parsing fails
 */
const tryParseJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  try {
    const trimmed = value.trim()
    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      return JSON.parse(trimmed)
    }
  } catch {
    // Not valid JSON, return original
  }
  return value
}

/**
 * Formats a subblock value for display, intelligently handling nested objects and arrays.
 * Used by both the canvas workflow blocks and copilot edit summaries.
 */
export const getDisplayValue = (value: unknown): string => {
  if (value == null || value === '') return '-'

  const parsedValue = tryParseJson(value)

  if (isMessagesArray(parsedValue)) {
    const firstMessage = parsedValue[0]
    if (!firstMessage?.content || firstMessage.content.trim() === '') return '-'
    const content = firstMessage.content.trim()
    return content.length > 50 ? `${content.slice(0, 50)}...` : content
  }

  if (isVariableAssignmentsArray(parsedValue)) {
    const names = parsedValue.map((a) => a.variableName).filter((name): name is string => !!name)
    if (names.length === 0) return '-'
    if (names.length === 1) return names[0]
    if (names.length === 2) return `${names[0]}, ${names[1]}`
    return `${names[0]}, ${names[1]} +${names.length - 2}`
  }

  if (isTagFilterArray(parsedValue)) {
    const validFilters = parsedValue.filter((f) => f.tagName?.trim())
    if (validFilters.length === 0) return '-'
    if (validFilters.length === 1) return validFilters[0].tagName
    if (validFilters.length === 2) return `${validFilters[0].tagName}, ${validFilters[1].tagName}`
    return `${validFilters[0].tagName}, ${validFilters[1].tagName} +${validFilters.length - 2}`
  }

  if (isDocumentTagArray(parsedValue)) {
    const validTags = parsedValue.filter((t) => t.tagName?.trim())
    if (validTags.length === 0) return '-'
    if (validTags.length === 1) return validTags[0].tagName
    if (validTags.length === 2) return `${validTags[0].tagName}, ${validTags[1].tagName}`
    return `${validTags[0].tagName}, ${validTags[1].tagName} +${validTags.length - 2}`
  }

  if (isTableRowArray(parsedValue)) {
    const nonEmptyRows = parsedValue.filter((row) => {
      const cellValues = Object.values(row.cells)
      return cellValues.some((cell) => cell && cell.trim() !== '')
    })

    if (nonEmptyRows.length === 0) return '-'
    if (nonEmptyRows.length === 1) {
      const firstRow = nonEmptyRows[0]
      const cellEntries = Object.entries(firstRow.cells).filter(([, val]) => val?.trim())
      if (cellEntries.length === 0) return '-'
      const preview = cellEntries
        .slice(0, 2)
        .map(([key, val]) => `${key}: ${val}`)
        .join(', ')
      return cellEntries.length > 2 ? `${preview}...` : preview
    }
    return `${nonEmptyRows.length} rows`
  }

  if (isFieldFormatArray(parsedValue)) {
    const namedFields = parsedValue.filter((field) => field.name && field.name.trim() !== '')
    if (namedFields.length === 0) return '-'
    if (namedFields.length === 1) return namedFields[0].name
    if (namedFields.length === 2) return `${namedFields[0].name}, ${namedFields[1].name}`
    return `${namedFields[0].name}, ${namedFields[1].name} +${namedFields.length - 2}`
  }

  if (isPlainObject(parsedValue)) {
    const entries = Object.entries(parsedValue).filter(
      ([, val]) => val !== null && val !== undefined && val !== ''
    )

    if (entries.length === 0) return '-'
    if (entries.length === 1) {
      const [key, val] = entries[0]
      const valStr = String(val).slice(0, 30)
      return `${key}: ${valStr}${String(val).length > 30 ? '...' : ''}`
    }
    const preview = entries
      .slice(0, 2)
      .map(([key]) => key)
      .join(', ')
    return entries.length > 2 ? `${preview} +${entries.length - 2}` : preview
  }

  if (Array.isArray(parsedValue)) {
    const nonEmptyItems = parsedValue.filter(
      (item) => item !== null && item !== undefined && item !== ''
    )
    if (nonEmptyItems.length === 0) return '-'

    const getItemDisplayValue = (item: unknown): string => {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>
        return String(obj.title || obj.name || obj.label || obj.id || JSON.stringify(item))
      }
      return String(item)
    }

    if (nonEmptyItems.length === 1) return getItemDisplayValue(nonEmptyItems[0])
    if (nonEmptyItems.length === 2) {
      return `${getItemDisplayValue(nonEmptyItems[0])}, ${getItemDisplayValue(nonEmptyItems[1])}`
    }
    return `${getItemDisplayValue(nonEmptyItems[0])}, ${getItemDisplayValue(nonEmptyItems[1])} +${nonEmptyItems.length - 2}`
  }

  // For non-array, non-object values, use original value for string conversion
  const stringValue = String(value)
  if (stringValue === '[object Object]') {
    try {
      const json = JSON.stringify(parsedValue)
      if (json.length <= 40) return json
      return `${json.slice(0, 37)}...`
    } catch {
      return '-'
    }
  }

  return stringValue.trim().length > 0 ? stringValue : '-'
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
    workflowId
  )

  const credentialId = dependencyValues.credential
  const knowledgeBaseId = dependencyValues.knowledgeBaseId

  const dropdownLabel = useMemo(() => {
    if (!subBlock || (subBlock.type !== 'dropdown' && subBlock.type !== 'combobox')) return null
    if (!rawValue || typeof rawValue !== 'string') return null

    const options = typeof subBlock.options === 'function' ? subBlock.options() : subBlock.options
    if (!options) return null

    const option = options.find((opt) =>
      typeof opt === 'string' ? opt === rawValue : opt.id === rawValue
    )

    if (!option) return null
    return typeof option === 'string' ? option : option.label
  }, [subBlock, rawValue])

  const domainValue = getStringValue('domain')
  const teamIdValue = getStringValue('teamId')
  const projectIdValue = getStringValue('projectId')
  const planIdValue = getStringValue('planId')

  const { displayName: selectorDisplayName } = useSelectorDisplayName({
    subBlock,
    value: rawValue,
    workflowId,
    credentialId: typeof credentialId === 'string' ? credentialId : undefined,
    knowledgeBaseId: typeof knowledgeBaseId === 'string' ? knowledgeBaseId : undefined,
    domain: domainValue,
    teamId: teamIdValue,
    projectId: projectIdValue,
    planId: planIdValue,
  })

  const { knowledgeBase: kbForDisplayName } = useKnowledgeBase(
    subBlock?.type === 'knowledge-base-selector' && typeof rawValue === 'string' ? rawValue : ''
  )
  const knowledgeBaseDisplayName = kbForDisplayName?.name ?? null

  const workflowMap = useWorkflowRegistry((state) => state.workflows)
  const workflowSelectionName =
    subBlock?.id === 'workflowId' && typeof rawValue === 'string'
      ? (workflowMap[rawValue]?.name ?? null)
      : null

  const { data: mcpServers = [] } = useMcpServers(workspaceId || '')
  const mcpServerDisplayName = useMemo(() => {
    if (subBlock?.type !== 'mcp-server-selector' || typeof rawValue !== 'string') {
      return null
    }
    const server = mcpServers.find((s) => s.id === rawValue)
    return server?.name ?? null
  }, [subBlock?.type, rawValue, mcpServers])

  const { data: mcpToolsData = [] } = useMcpToolsQuery(workspaceId || '')
  const mcpToolDisplayName = useMemo(() => {
    if (subBlock?.type !== 'mcp-tool-selector' || typeof rawValue !== 'string') {
      return null
    }

    const tool = mcpToolsData.find((t) => {
      const toolId = createMcpToolId(t.serverId, t.name)
      return toolId === rawValue
    })
    return tool?.name ?? null
  }, [subBlock?.type, rawValue, mcpToolsData])

  const webhookUrlDisplayValue = useMemo(() => {
    if (subBlock?.id !== 'webhookUrlDisplay' || !blockId) {
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

  const variablesDisplayValue = useMemo(() => {
    if (subBlock?.type !== 'variables-input' || !isVariableAssignmentsArray(rawValue)) {
      return null
    }

    const variablesArray = Object.values(workflowVariables)

    const names = rawValue
      .map((a) => {
        if (a.variableId) {
          const variable = variablesArray.find((v: any) => v.id === a.variableId)
          return variable?.name
        }
        if (a.variableName) return a.variableName
        return null
      })
      .filter((name): name is string => !!name)

    if (names.length === 0) return null
    if (names.length === 1) return names[0]
    if (names.length === 2) return `${names[0]}, ${names[1]}`
    return `${names[0]}, ${names[1]} +${names.length - 2}`
  }, [subBlock?.type, rawValue, workflowVariables])

  /**
   * Hydrates tool references to display names.
   * Follows the same pattern as other selectors (Slack channels, MCP tools, etc.)
   */
  const { data: customTools = [] } = useCustomTools(workspaceId || '')

  const toolsDisplayValue = useMemo(() => {
    if (subBlock?.type !== 'tool-input' || !Array.isArray(rawValue) || rawValue.length === 0) {
      return null
    }

    const toolNames = rawValue
      .map((tool: any) => {
        if (!tool || typeof tool !== 'object') return null

        // Priority 1: Use tool.title if already populated
        if (tool.title && typeof tool.title === 'string') return tool.title

        // Priority 2: Resolve custom tools with reference ID from database
        if (tool.type === 'custom-tool' && tool.customToolId) {
          const customTool = customTools.find((t) => t.id === tool.customToolId)
          if (customTool?.title) return customTool.title
          if (customTool?.schema?.function?.name) return customTool.schema.function.name
        }

        // Priority 3: Extract from inline schema (legacy format)
        if (tool.schema?.function?.name) return tool.schema.function.name

        // Priority 4: Extract from OpenAI function format
        if (tool.function?.name) return tool.function.name

        // Priority 5: Resolve built-in tool blocks from registry
        if (
          typeof tool.type === 'string' &&
          tool.type !== 'custom-tool' &&
          tool.type !== 'mcp' &&
          tool.type !== 'workflow' &&
          tool.type !== 'workflow_input'
        ) {
          const blockConfig = getBlock(tool.type)
          if (blockConfig?.name) return blockConfig.name
        }

        return null
      })
      .filter((name): name is string => !!name)

    if (toolNames.length === 0) return null
    if (toolNames.length === 1) return toolNames[0]
    if (toolNames.length === 2) return `${toolNames[0]}, ${toolNames[1]}`
    return `${toolNames[0]}, ${toolNames[1]} +${toolNames.length - 2}`
  }, [subBlock?.type, rawValue, customTools, workspaceId])

  /**
   * Hydrates skill references to display names.
   * Resolves skill IDs to their current names from the skills query.
   */
  const { data: workspaceSkills = [] } = useSkills(workspaceId || '')

  const skillsDisplayValue = useMemo(() => {
    if (subBlock?.type !== 'skill-input' || !Array.isArray(rawValue) || rawValue.length === 0) {
      return null
    }

    interface StoredSkill {
      skillId: string
      name?: string
    }

    const skillNames = rawValue
      .map((skill: StoredSkill) => {
        if (!skill || typeof skill !== 'object') return null

        // Priority 1: Resolve skill name from the skills query (fresh data)
        if (skill.skillId) {
          const foundSkill = workspaceSkills.find((s) => s.id === skill.skillId)
          if (foundSkill?.name) return foundSkill.name
        }

        // Priority 2: Fall back to stored name (for deleted skills)
        if (skill.name && typeof skill.name === 'string') return skill.name

        // Priority 3: Use skillId as last resort
        if (skill.skillId) return skill.skillId

        return null
      })
      .filter((name): name is string => !!name)

    if (skillNames.length === 0) return null
    if (skillNames.length === 1) return skillNames[0]
    if (skillNames.length === 2) return `${skillNames[0]}, ${skillNames[1]}`
    return `${skillNames[0]}, ${skillNames[1]} +${skillNames.length - 2}`
  }, [subBlock?.type, rawValue, workspaceSkills])

  const isPasswordField = subBlock?.password === true
  const maskedValue = isPasswordField && value && value !== '-' ? '•••' : null

  const isSelectorType = subBlock?.type && SELECTOR_TYPES_HYDRATION_REQUIRED.includes(subBlock.type)
  const hydratedName =
    credentialName ||
    dropdownLabel ||
    variablesDisplayValue ||
    toolsDisplayValue ||
    skillsDisplayValue ||
    knowledgeBaseDisplayName ||
    workflowSelectionName ||
    mcpServerDisplayName ||
    mcpToolDisplayName ||
    webhookUrlDisplayValue ||
    selectorDisplayName
  const displayValue = maskedValue || hydratedName || (isSelectorType && value ? '-' : value)

  return (
    <div className='flex items-center gap-[8px]'>
      <span
        className='min-w-0 truncate text-[14px] text-[var(--text-tertiary)] capitalize'
        title={title}
      >
        {title}
      </span>
      {displayValue !== undefined && (
        <span
          className='flex-1 truncate text-right text-[14px] text-[var(--text-primary)]'
          title={displayValue}
        >
          {displayValue}
        </span>
      )}
    </div>
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
  const currentWorkflowId = params.workflowId as string
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

  const { mutate: deployChildWorkflow, isPending: isDeploying } = useDeployChildWorkflow()

  const userPermissions = useUserPermissionsContext()

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
  const canonicalIndex = useMemo(() => buildCanonicalIndex(config.subBlocks), [config.subBlocks])
  const canonicalModeOverrides = currentStoreBlock?.data?.canonicalModes

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

    const effectiveAdvanced = userPermissions.canEdit
      ? displayAdvancedMode
      : displayAdvancedMode || hasAdvancedValues(config.subBlocks, rawValues, canonicalIndex)
    const effectiveTrigger = displayTriggerMode

    const visibleSubBlocks = config.subBlocks.filter((block) => {
      if (block.hidden) return false
      if (block.hideFromPreview) return false
      if (!isSubBlockFeatureEnabled(block)) return false

      const isPureTriggerBlock = config?.triggers?.enabled && config.category === 'triggers'

      if (effectiveTrigger) {
        const isValidTriggerSubblock = isPureTriggerBlock
          ? block.mode === 'trigger' || !block.mode
          : block.mode === 'trigger'

        if (!isValidTriggerSubblock) {
          return false
        }
      } else {
        if (block.mode === 'trigger') {
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
    userPermissions.canEdit,
    canonicalIndex,
    blockSubBlockValues,
    activeWorkflowId,
  ])

  const subBlockRows = subBlockRowsData.rows
  const subBlockState = subBlockRowsData.stateToUse
  const effectiveAdvanced = useMemo(() => {
    const rawValues = Object.entries(subBlockState).reduce<Record<string, unknown>>(
      (acc, [key, entry]) => {
        acc[key] = entry?.value
        return acc
      },
      {}
    )
    return userPermissions.canEdit
      ? displayAdvancedMode
      : displayAdvancedMode || hasAdvancedValues(config.subBlocks, rawValues, canonicalIndex)
  }, [
    subBlockState,
    displayAdvancedMode,
    config.subBlocks,
    canonicalIndex,
    userPermissions.canEdit,
  ])

  /**
   * Determine if block has content below the header (subblocks or error row).
   * Controls header border visibility and content container rendering.
   */
  const shouldShowDefaultHandles =
    config.category !== 'triggers' && type !== 'starter' && !displayTriggerMode
  const hasContentBelowHeader = subBlockRows.length > 0 || shouldShowDefaultHandles

  /**
   * Reusable styles and positioning for Handle components.
   */
  const getHandleClasses = (position: 'left' | 'right' | 'top' | 'bottom', isError = false) => {
    const baseClasses = '!z-[10] !cursor-crosshair !border-none !transition-[colors] !duration-150'
    const colorClasses = isError ? '!bg-[var(--text-error)]' : '!bg-[var(--workflow-edge)]'

    const positionClasses = {
      left: '!left-[-8px] !h-5 !w-[7px] !rounded-l-[2px] !rounded-r-none hover:!left-[-11px] hover:!w-[10px] hover:!rounded-l-full',
      right:
        '!right-[-8px] !h-5 !w-[7px] !rounded-r-[2px] !rounded-l-none hover:!right-[-11px] hover:!w-[10px] hover:!rounded-r-full',
      top: '!top-[-8px] !h-[7px] !w-5 !rounded-t-[2px] !rounded-b-none hover:!top-[-11px] hover:!h-[10px] hover:!rounded-t-full',
      bottom:
        '!bottom-[-8px] !h-[7px] !w-5 !rounded-b-[2px] !rounded-t-none hover:!bottom-[-11px] hover:!h-[10px] hover:!rounded-b-full',
    }

    return cn(baseClasses, colorClasses, positionClasses[position])
  }

  const getHandleStyle = (position: 'horizontal' | 'vertical') => {
    if (position === 'horizontal') {
      return { top: `${HANDLE_POSITIONS.DEFAULT_Y_OFFSET}px`, transform: 'translateY(-50%)' }
    }
    return { left: '50%', transform: 'translateX(-50%)' }
  }

  /**
   * Compute per-condition rows (title/value/id) for condition blocks so we can render
   * one row per condition statement with its own output handle.
   */
  const conditionRows = useMemo(() => {
    if (type !== 'condition') return [] as { id: string; title: string; value: string }[]

    const conditionsValue = subBlockState.conditions?.value
    const raw = typeof conditionsValue === 'string' ? conditionsValue : undefined

    try {
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          return parsed.map((item: unknown, index: number) => {
            const conditionItem = item as { id?: string; value?: unknown }
            const title = index === 0 ? 'if' : index === parsed.length - 1 ? 'else' : 'else if'
            return {
              id: conditionItem?.id ?? `${id}-cond-${index}`,
              title,
              value: typeof conditionItem?.value === 'string' ? conditionItem.value : '',
            }
          })
        }
      }
    } catch (error) {
      logger.warn('Failed to parse condition subblock value', { error, blockId: id })
    }

    return [
      { id: `${id}-if`, title: 'if', value: '' },
      { id: `${id}-else`, title: 'else', value: '' },
    ]
  }, [type, subBlockState, id])

  /**
   * Compute per-route rows (id/value) for router_v2 blocks so we can render
   * one row per route with its own output handle.
   * Uses same structure as conditions: { id, title, value }
   */
  const routerRows = useMemo(() => {
    if (type !== 'router_v2') return [] as { id: string; value: string }[]

    const routesValue = subBlockState.routes?.value
    const raw = typeof routesValue === 'string' ? routesValue : undefined

    try {
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          return parsed.map((item: unknown, index: number) => {
            const routeItem = item as { id?: string; value?: string }
            return {
              // Use stable ID format that matches ConditionInput's generateStableId
              id: routeItem?.id ?? `${id}-route${index + 1}`,
              value: routeItem?.value ?? '',
            }
          })
        }
      }
    } catch (error) {
      logger.warn('Failed to parse router routes value', { error, blockId: id })
    }

    // Fallback must match ConditionInput's default: generateStableId(blockId, 'route1') = `${blockId}-route1`
    return [{ id: `${id}-route1`, value: '' }]
  }, [type, subBlockState, id])

  /**
   * Compute and publish deterministic layout metrics for workflow blocks.
   * This avoids ResizeObserver/animation-frame jitter and prevents initial "jump".
   */
  useBlockDimensions({
    blockId: id,
    calculateDimensions: () => {
      const shouldShowDefaultHandles =
        config.category !== 'triggers' && type !== 'starter' && !displayTriggerMode
      const hasContentBelowHeader = subBlockRows.length > 0 || shouldShowDefaultHandles

      const defaultHandlesRow = shouldShowDefaultHandles ? 1 : 0

      let rowsCount = 0
      if (type === 'condition') {
        rowsCount = conditionRows.length + defaultHandlesRow
      } else if (type === 'router_v2') {
        // +1 for context row, plus route rows
        rowsCount = 1 + routerRows.length + defaultHandlesRow
      } else {
        const subblockRowCount = subBlockRows.reduce((acc, row) => acc + row.length, 0)
        rowsCount = subblockRowCount + defaultHandlesRow
      }

      const contentHeight = hasContentBelowHeader
        ? BLOCK_DIMENSIONS.WORKFLOW_CONTENT_PADDING +
          rowsCount * BLOCK_DIMENSIONS.WORKFLOW_ROW_HEIGHT
        : 0
      const calculatedHeight = Math.max(
        BLOCK_DIMENSIONS.HEADER_HEIGHT + contentHeight,
        BLOCK_DIMENSIONS.MIN_HEIGHT
      )

      return { width: BLOCK_DIMENSIONS.FIXED_WIDTH, height: calculatedHeight }
    },
    dependencies: [
      type,
      config.category,
      displayTriggerMode,
      subBlockRows.reduce((acc, row) => acc + row.length, 0),
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

  return (
    <div className='group relative'>
      <div
        ref={contentRef}
        onClick={handleClick}
        className={cn(
          'workflow-drag-handle relative z-[20] w-[250px] cursor-grab select-none rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-2)] [&:active]:cursor-grabbing'
        )}
      >
        {isPending && (
          <div className='-top-6 -translate-x-1/2 absolute left-1/2 z-10 transform rounded-t-md bg-amber-500 px-2 py-0.5 text-white text-xs'>
            Next Step
          </div>
        )}

        {!data.isPreview && (
          <ActionBar blockId={id} blockType={type} disabled={!userPermissions.canEdit} />
        )}

        {shouldShowDefaultHandles && (
          <Handle
            type='target'
            position={horizontalHandles ? Position.Left : Position.Top}
            id='target'
            className={getHandleClasses(horizontalHandles ? 'left' : 'top')}
            style={getHandleStyle(horizontalHandles ? 'horizontal' : 'vertical')}
            data-nodeid={id}
            data-handleid='target'
            isConnectableStart={false}
            isConnectableEnd={true}
            isValidConnection={(connection) => {
              if (connection.source === id) return false
              const edges = useWorkflowStore.getState().edges
              return !wouldCreateCycle(edges, connection.source!, connection.target!)
            }}
          />
        )}

        <div
          className={cn(
            'flex items-center justify-between p-[8px]',
            hasContentBelowHeader && 'border-[var(--border-1)] border-b'
          )}
        >
          <div className='relative z-10 flex min-w-0 flex-1 items-center gap-[10px]'>
            <div
              className='flex h-[24px] w-[24px] flex-shrink-0 items-center justify-center rounded-[6px]'
              style={{
                background: isEnabled ? config.bgColor : 'gray',
              }}
            >
              <config.icon className='h-[16px] w-[16px] text-white' />
            </div>
            <span
              className={cn(
                'truncate font-medium text-[16px]',
                !isEnabled && runPathStatus !== 'success' && 'text-[var(--text-muted)]'
              )}
              title={name}
            >
              {name}
            </span>
          </div>
          <div className='relative z-10 flex flex-shrink-0 items-center gap-1'>
            {isWorkflowSelector &&
              childWorkflowId &&
              typeof childIsDeployed === 'boolean' &&
              (!childIsDeployed || childNeedsRedeploy) && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Badge
                      variant={!childIsDeployed ? 'red' : 'amber'}
                      className={userPermissions.canAdmin ? 'cursor-pointer' : 'cursor-not-allowed'}
                      dot
                      onClick={(e) => {
                        e.stopPropagation()
                        if (childWorkflowId && !isDeploying && userPermissions.canAdmin) {
                          deployChildWorkflow({ workflowId: childWorkflowId })
                        }
                      }}
                    >
                      {isDeploying ? 'Deploying...' : !childIsDeployed ? 'undeployed' : 'redeploy'}
                    </Badge>
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    <span className='text-sm'>
                      {!userPermissions.canAdmin
                        ? 'Admin permission required to deploy'
                        : !childIsDeployed
                          ? 'Click to deploy'
                          : 'Click to redeploy'}
                    </span>
                  </Tooltip.Content>
                </Tooltip.Root>
              )}
            {!isEnabled && <Badge variant='gray-secondary'>disabled</Badge>}
            {isLocked && <Badge variant='gray-secondary'>locked</Badge>}

            {type === 'schedule' && shouldShowScheduleBadge && scheduleInfo?.isDisabled && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Badge
                    variant='amber'
                    className='cursor-pointer'
                    dot
                    onClick={(e) => {
                      e.stopPropagation()
                      if (scheduleInfo?.id) {
                        reactivateSchedule(scheduleInfo.id)
                      }
                    }}
                  >
                    disabled
                  </Badge>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span className='text-sm'>Click to reactivate</span>
                </Tooltip.Content>
              </Tooltip.Root>
            )}

            {showWebhookIndicator && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Badge variant='orange' dot>
                    Webhook
                  </Badge>
                </Tooltip.Trigger>
                <Tooltip.Content side='top' className='max-w-[300px]'>
                  {webhookProvider && webhookPath ? (
                    <>
                      <p className='text-sm'>{getProviderName(webhookProvider)} Webhook</p>
                      <p className='mt-1 text-muted-foreground text-xs'>Path: {webhookPath}</p>
                    </>
                  ) : (
                    <p className='text-muted-foreground text-sm'>
                      This workflow is triggered by a webhook.
                    </p>
                  )}
                </Tooltip.Content>
              </Tooltip.Root>
            )}

            {isWebhookConfigured && isWebhookDisabled && webhookId && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Badge
                    variant='amber'
                    className='cursor-pointer'
                    dot
                    onClick={(e) => {
                      e.stopPropagation()
                      reactivateWebhook(webhookId)
                    }}
                  >
                    disabled
                  </Badge>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span className='text-sm'>Click to reactivate</span>
                </Tooltip.Content>
              </Tooltip.Root>
            )}
            {/* {isActive && (
              <div className='mr-[2px] ml-2 flex h-[16px] w-[16px] items-center justify-center'>
                <div
                  className='h-full w-full animate-spin-slow rounded-full border-[2.5px] border-[rgba(255,102,0,0.25)] border-t-[var(--warning)]'
                  aria-hidden='true'
                />
              </div>
            )} */}
          </div>
        </div>

        {hasContentBelowHeader && (
          <div className='flex flex-col gap-[8px] p-[8px]'>
            {type === 'condition' ? (
              conditionRows.map((cond) => (
                <SubBlockRow key={cond.id} title={cond.title} value={getDisplayValue(cond.value)} />
              ))
            ) : type === 'router_v2' ? (
              <>
                <SubBlockRow
                  key='context'
                  title='Context'
                  value={getDisplayValue(subBlockState.context?.value)}
                />
                {routerRows.map((route, index) => (
                  <SubBlockRow
                    key={route.id}
                    title={`Route ${index + 1}`}
                    value={getDisplayValue(route.value)}
                  />
                ))}
              </>
            ) : (
              subBlockRows.map((row, rowIndex) =>
                row.map((subBlock) => {
                  const rawValue = subBlockState[subBlock.id]?.value
                  return (
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
                    />
                  )
                })
              )
            )}
            {shouldShowDefaultHandles && <SubBlockRow title='error' />}
          </div>
        )}

        {type === 'condition' && (
          <>
            {conditionRows.map((cond, condIndex) => {
              const topOffset =
                HANDLE_POSITIONS.CONDITION_START_Y +
                condIndex * HANDLE_POSITIONS.CONDITION_ROW_HEIGHT
              return (
                <Handle
                  key={`handle-${cond.id}`}
                  type='source'
                  position={Position.Right}
                  id={`condition-${cond.id}`}
                  className={getHandleClasses('right')}
                  style={{ top: `${topOffset}px`, transform: 'translateY(-50%)' }}
                  data-nodeid={id}
                  data-handleid={`condition-${cond.id}`}
                  isConnectableStart={true}
                  isConnectableEnd={false}
                  isValidConnection={(connection) => {
                    if (connection.target === id) return false
                    const edges = useWorkflowStore.getState().edges
                    return !wouldCreateCycle(edges, connection.source!, connection.target!)
                  }}
                />
              )
            })}
            <Handle
              type='source'
              position={Position.Right}
              id='error'
              className={getHandleClasses('right', true)}
              style={{
                right: '-7px',
                top: 'auto',
                bottom: `${HANDLE_POSITIONS.ERROR_BOTTOM_OFFSET}px`,
                transform: 'translateY(50%)',
              }}
              data-nodeid={id}
              data-handleid='error'
              isConnectableStart={true}
              isConnectableEnd={false}
              isValidConnection={(connection) => {
                if (connection.target === id) return false
                const edges = useWorkflowStore.getState().edges
                return !wouldCreateCycle(edges, connection.source!, connection.target!)
              }}
            />
          </>
        )}

        {type === 'router_v2' && (
          <>
            {routerRows.map((route, routeIndex) => {
              // +1 row offset for context row at the top
              const topOffset =
                HANDLE_POSITIONS.CONDITION_START_Y +
                (routeIndex + 1) * HANDLE_POSITIONS.CONDITION_ROW_HEIGHT
              return (
                <Handle
                  key={`handle-${route.id}`}
                  type='source'
                  position={Position.Right}
                  id={`router-${route.id}`}
                  className={getHandleClasses('right')}
                  style={{ top: `${topOffset}px`, transform: 'translateY(-50%)' }}
                  data-nodeid={id}
                  data-handleid={`router-${route.id}`}
                  isConnectableStart={true}
                  isConnectableEnd={false}
                  isValidConnection={(connection) => {
                    if (connection.target === id) return false
                    const edges = useWorkflowStore.getState().edges
                    return !wouldCreateCycle(edges, connection.source!, connection.target!)
                  }}
                />
              )
            })}
            <Handle
              type='source'
              position={Position.Right}
              id='error'
              className={getHandleClasses('right', true)}
              style={{
                right: '-7px',
                top: 'auto',
                bottom: `${HANDLE_POSITIONS.ERROR_BOTTOM_OFFSET}px`,
                transform: 'translateY(50%)',
              }}
              data-nodeid={id}
              data-handleid='error'
              isConnectableStart={true}
              isConnectableEnd={false}
              isValidConnection={(connection) => {
                if (connection.target === id) return false
                const edges = useWorkflowStore.getState().edges
                return !wouldCreateCycle(edges, connection.source!, connection.target!)
              }}
            />
          </>
        )}

        {type !== 'condition' && type !== 'router_v2' && type !== 'response' && (
          <>
            <Handle
              type='source'
              position={horizontalHandles ? Position.Right : Position.Bottom}
              id='source'
              className={getHandleClasses(horizontalHandles ? 'right' : 'bottom')}
              style={getHandleStyle(horizontalHandles ? 'horizontal' : 'vertical')}
              data-nodeid={id}
              data-handleid='source'
              isConnectableStart={true}
              isConnectableEnd={false}
              isValidConnection={(connection) => {
                if (connection.target === id) return false
                const edges = useWorkflowStore.getState().edges
                return !wouldCreateCycle(edges, connection.source!, connection.target!)
              }}
            />

            {shouldShowDefaultHandles && (
              <Handle
                type='source'
                position={Position.Right}
                id='error'
                className={getHandleClasses('right', true)}
                style={{
                  right: '-7px',
                  top: 'auto',
                  bottom: `${HANDLE_POSITIONS.ERROR_BOTTOM_OFFSET}px`,
                  transform: 'translateY(50%)',
                }}
                data-nodeid={id}
                data-handleid='error'
                isConnectableStart={true}
                isConnectableEnd={false}
                isValidConnection={(connection) => {
                  if (connection.target === id) return false
                  const edges = useWorkflowStore.getState().edges
                  return !wouldCreateCycle(edges, connection.source!, connection.target!)
                }}
              />
            )}
          </>
        )}
        {hasRing && (
          <div
            className={cn('pointer-events-none absolute inset-0 z-40 rounded-[8px]', ringStyles)}
          />
        )}
      </div>
    </div>
  )
}, shouldSkipBlockRender)
