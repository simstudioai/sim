import { type ComponentType, Fragment, memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { SubBlockRowView, WorkflowBlockView } from '@sim/workflow-renderer'
import { isPositionedSourceHandle, isPositionedTargetHandle } from '@sim/workflow-types/workflow'
import { isEqual } from 'es-toolkit'
import {
  ArrowLeftRight,
  ArrowUpDown,
  Braces,
  Clock,
  Globe,
  Hash,
  KeyRound,
  ListFilter,
  MessageSquareText,
  Paperclip,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  ToggleLeft,
  Wrench,
} from 'lucide-react'
import { useParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { type NodeProps, useStore as useReactFlowStore, useUpdateNodeInternals } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { isChatEnabled } from '@/lib/core/config/env-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createMcpToolId } from '@/lib/mcp/shared'
import { sendMothershipMessage } from '@/lib/mothership/events'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import { captureEvent } from '@/lib/posthog/client'
import { resolveCanvasBlockPresentation } from '@/lib/workflows/blocks/canvas-presentation'
import { calculateWorkflowBlockDimensions } from '@/lib/workflows/blocks/deterministic-dimensions'
import { getConditionRows, getRouterRows } from '@/lib/workflows/dynamic-handle-topology'
import {
  getDisplayValue,
  hasDisplayableRowValue,
  resolveDropdownLabel,
  resolveFilterFieldLabel,
  resolveSandboxLabel,
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
  isToolInputOnlySubBlock,
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
import {
  useBlockVisual,
  useIsBlockInActiveExecutionHandoff,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
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
import { useSandboxes } from '@/hooks/queries/sandboxes'
import { useReactivateSchedule, useScheduleInfo } from '@/hooks/queries/schedules'
import { useSkills } from '@/hooks/queries/skills'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflowMap } from '@/hooks/queries/workflows'
import { useReactiveConditions } from '@/hooks/use-reactive-conditions'
import { useSelectorDisplayName } from '@/hooks/use-selector-display-name'
import { getModelSunsetStatus } from '@/providers/models'
import { useIsCurrentWorkflowExecuting } from '@/stores/execution'
import { usePanelEditorStore, usePanelStore } from '@/stores/panel'
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

/**
 * Selector subblock types whose hydrated value names the block's primary
 * target (table, channel, knowledge base, …) — promoted to a chip.
 */
const CHIP_TARGET_SELECTOR_TYPES = new Set<string>([
  'table-selector',
  'knowledge-base-selector',
  'workflow-selector',
  'mcp-server-selector',
  'mcp-tool-selector',
  'channel-selector',
  'user-selector',
  'file-selector',
  'sheet-selector',
  'folder-selector',
  'project-selector',
  'document-selector',
])

/** Maximum fragments in the statement line; remaining candidates fall back to rows. */
const MAX_CHIPS = 2

type MetaIcon = ComponentType<{ className?: string }>

/** Leading icons for compact meta rows, keyed by subblock id. */
const SUBBLOCK_META_ICONS_BY_ID: Record<string, MetaIcon> = {
  filterBuilder: ListFilter,
  bulkFilterBuilder: ListFilter,
  filter: ListFilter,
  filterCriteria: ListFilter,
  sortBuilder: ArrowUpDown,
  sort: ArrowUpDown,
  limit: Hash,
  offset: SkipForward,
  rowId: KeyRound,
  url: Globe,
  method: ArrowLeftRight,
  body: Braces,
  data: Braces,
}

/** Leading icons for compact meta rows, keyed by subblock type. */
const SUBBLOCK_META_ICONS_BY_TYPE: Record<string, MetaIcon> = {
  code: Braces,
  'messages-input': MessageSquareText,
  'tool-input': Wrench,
  'skill-input': Sparkles,
  'oauth-input': KeyRound,
  switch: ToggleLeft,
  'file-upload': Paperclip,
  'time-input': Clock,
  slider: SlidersHorizontal,
}

/** Resolves the meta-row icon for a subblock; null keeps the labeled row. */
function getMetaIcon(subBlock: SubBlockConfig): MetaIcon | null {
  return (
    SUBBLOCK_META_ICONS_BY_ID[subBlock.id] ?? SUBBLOCK_META_ICONS_BY_TYPE[subBlock.type] ?? null
  )
}

/** A value token in a summary sentence, referencing a visible subblock. */
interface SentenceToken {
  id: string
}

type SentenceSegment = string | SentenceToken

const T = (id: string): SentenceToken => ({ id })

/**
 * Builds the natural-language summary for a block as text fragments
 * interleaved with value tokens (rendered as inline chips). Returns null for
 * block types or states without a template - those keep the field-row layout.
 * `resolve` returns the first listed subblock id that is visible with a
 * displayable value, so templates only reference real, configured fields.
 */
function buildSentenceSegments(
  type: string,
  operation: unknown,
  resolve: (...ids: string[]) => string | null
): SentenceSegment[] | null {
  if (type === 'table') {
    const table = resolve('tableSelector', 'manualTableId')
    if (!table) return null
    const rowId = resolve('rowId')
    const data = resolve('data')
    const filter = resolve('filterBuilder', 'bulkFilterBuilder', 'filter')
    const sort = resolve('sortBuilder', 'sort')
    const limit = resolve('limit')

    switch (operation) {
      case 'query_rows': {
        const segments: SentenceSegment[] = ['Queries rows from', T(table)]
        if (filter) segments.push(', where', T(filter))
        if (sort) segments.push(', sorted by', T(sort))
        if (limit) segments.push(', up to', T(limit), 'rows')
        return segments
      }
      case 'insert_row':
        return ['Inserts a row into', T(table), ...(data ? [', with', T(data)] : [])]
      case 'upsert_row': {
        const conflict = resolve('conflictColumnSelector', 'manualConflictColumn')
        return ['Upserts a row into', T(table), ...(conflict ? [', keyed on', T(conflict)] : [])]
      }
      case 'batch_insert_rows': {
        const rows = resolve('rows')
        return ['Inserts', ...(rows ? [T(rows)] : ['rows']), 'into', T(table)]
      }
      case 'update_row':
        return [
          'Updates row',
          ...(rowId ? [T(rowId)] : []),
          'in',
          T(table),
          ...(data ? [', setting', T(data)] : []),
        ]
      case 'delete_row':
        return ['Deletes row', ...(rowId ? [T(rowId)] : []), 'from', T(table)]
      case 'get_row':
        return ['Fetches row', ...(rowId ? [T(rowId)] : []), 'from', T(table)]
      case 'update_rows_by_filter':
        return [
          'Updates rows in',
          T(table),
          ...(filter ? [', where', T(filter)] : []),
          ...(data ? [', setting', T(data)] : []),
        ]
      case 'delete_rows_by_filter':
        return ['Deletes rows from', T(table), ...(filter ? [', where', T(filter)] : [])]
      case 'get_schema':
        return ['Reads the schema of', T(table)]
      default:
        return null
    }
  }

  if (type === 'agent') {
    const model = resolve('model')
    if (!model) return null
    const messages = resolve('messages')
    const tools = resolve('tools')
    const segments: SentenceSegment[] = ['Prompts', T(model)]
    if (messages) segments.push('with', T(messages))
    if (tools) segments.push(', using', T(tools))
    return segments
  }

  if (type === 'api') {
    const url = resolve('url')
    if (!url) return null
    const method = resolve('method')
    const body = resolve('body')
    const segments: SentenceSegment[] = method
      ? ['Sends a', T(method), 'request to', T(url)]
      : ['Sends a request to', T(url)]
    if (body) segments.push(', with body', T(body))
    return segments
  }

  if (type === 'function') {
    const code = resolve('code')
    if (!code) return null
    return ['Runs code', T(code)]
  }

  return null
}

/** Approximate character widths for the sentence line estimate (px). */
const SENTENCE_TEXT_CHAR_PX = 6.3
const SENTENCE_CHIP_CHAR_PX = 6.8
/** Inline chip horizontal padding + surrounding gap (px). */
const SENTENCE_CHIP_EXTRA_PX = 26
/** Usable sentence width inside the card (px). */
const SENTENCE_WRAP_WIDTH_PX = 224
/** Chip text is truncated around this many characters by max-width. */
const SENTENCE_CHIP_MAX_CHARS = 24
/**
 * Rendered cap on an inline value chip: `max-w-[160px]` on the chip itself
 * (see SubBlockRowView's `inline-value`). Without this clamp a long value is
 * estimated wider than it can ever paint, which predicts an extra wrapped
 * line and pads the card's height.
 */
const SENTENCE_CHIP_MAX_PX = 160

/**
 * Estimates the wrapped line count of a summary sentence for the
 * deterministic node height. Approximate by design - being off by a line
 * only affects node bounds, never handle anchoring (source/target anchor to
 * the header and the error port anchors to the bottom).
 */
function estimateSentenceLines(
  segments: SentenceSegment[],
  getValueText: (id: string) => string
): number {
  let widthPx = 0
  for (const segment of segments) {
    if (typeof segment === 'string') {
      widthPx += segment.length * SENTENCE_TEXT_CHAR_PX + 4
    } else {
      widthPx += Math.min(
        Math.min(getValueText(segment.id).length, SENTENCE_CHIP_MAX_CHARS) * SENTENCE_CHIP_CHAR_PX +
          SENTENCE_CHIP_EXTRA_PX,
        SENTENCE_CHIP_MAX_PX
      )
    }
  }
  return Math.max(1, Math.ceil(widthPx / SENTENCE_WRAP_WIDTH_PX))
}

/**
 * Priority for promoting a visible subblock into the chips row: the
 * operation first, then the primary target selector, then the model.
 * Returns null for subblocks that stay as label/value rows.
 */
function chipPriority(subBlock: SubBlockConfig): number | null {
  if (subBlock.id === 'operation') return 0
  if (CHIP_TARGET_SELECTOR_TYPES.has(subBlock.type)) return 1
  if (subBlock.id === 'model') return 2
  return null
}

/**
 * Names of MCP tool-schema parameters whose argument values are displayable
 * on the collapsed node. Params without a set value are hidden from the
 * preview, matching the empty-row filtering applied to regular subblocks.
 */
function getDisplayableMcpParamNames(schemaValue: unknown, argsValue: unknown): string[] {
  const schema = schemaValue as { properties?: Record<string, unknown> } | undefined
  const properties = schema?.properties
  if (!properties || typeof properties !== 'object') return []
  const args = (argsValue && typeof argsValue === 'object' ? argsValue : {}) as Record<
    string,
    unknown
  >
  return Object.keys(properties).filter((name) => getDisplayValue(args[name]) !== '-')
}

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
        tooltip: `${model} is a legacy model. Click to upgrade`,
        prompt: `The "${name}" block uses the legacy model "${model}". Switch it to the latest equivalent model.`,
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
  /** Presentation variant forwarded to the row view. */
  variant?: 'row' | 'meta' | 'statement-primary' | 'statement-muted' | 'inline-value'
  /** Leading icon forwarded to the row view (meta variant). */
  icon?: MetaIcon
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
    prevProps.canonicalModeOverrides === nextProps.canonicalModeOverrides &&
    prevProps.variant === nextProps.variant &&
    prevProps.icon === nextProps.icon
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
  variant,
  icon,
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

  /**
   * Hydrates the Function block's sandbox id to its name. Deliberately scoped to
   * the sandbox row: this row is memoized per subblock, and the shared list query
   * polls while a build is in flight, so subscribing unconditionally would
   * re-render every row on the canvas on each poll tick.
   */
  const isSandboxField = subBlock?.id === 'sandboxId' && subBlock?.type === 'combobox'
  const { data: sandboxData } = useSandboxes(isSandboxField ? workspaceId || undefined : undefined)
  const sandboxDisplayValue = useMemo(
    () => resolveSandboxLabel(subBlock, rawValue, sandboxData?.sandboxes ?? []),
    [subBlock, rawValue, sandboxData]
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
    sandboxDisplayValue ||
    knowledgeBaseDisplayName ||
    workflowSelectionName ||
    mcpServerDisplayName ||
    mcpToolDisplayName ||
    tableDisplayName ||
    webhookUrlDisplayValue ||
    selectorDisplayName
  const displayValue = maskedValue || hydratedName || (isSelectorType && value ? '-' : value)

  return (
    <SubBlockRowView
      title={title}
      displayValue={displayValue}
      isMonospace={isMonospaceField}
      variant={variant}
      icon={icon}
    />
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
    isExecuting,
    isLocked,
    handleClick,
    hasRing,
    ringStyles,
    runPathStatus,
  } = useBlockVisual({ blockId: id, data, isPending, isSelected: selected })

  const isWorkflowRunning = useIsCurrentWorkflowExecuting()
  const isExecutionHighlighted = useIsBlockInActiveExecutionHandoff(id)
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

  /**
   * Whether a persisted legacy error route is wired from this block. The
   * renderer uses this only to retain a non-interactive edge anchor.
   */
  const hasErrorConnection = useWorkflowStore(
    useCallback(
      (state) => state.edges.some((edge) => edge.source === id && edge.sourceHandle === 'error'),
      [id]
    )
  )

  /**
   * Handle ids whose connected edge is highlighted because an endpoint block
   * is selected — the view darkens those tabs to the edge highlight color so
   * port and line read as one piece. Serialized to a string so the ReactFlow
   * store subscription only re-renders on real changes.
   */
  const editorBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const { panelActiveTab, isPanelOpen } = usePanelStore(
    useShallow((state) => ({ panelActiveTab: state.activeTab, isPanelOpen: state.isOpen }))
  )
  const editorOpenBlockId = isPanelOpen && panelActiveTab === 'editor' ? editorBlockId : null
  const highlightedHandleKey = useReactFlowStore(
    useCallback(
      (state) => {
        const keys: string[] = []
        for (const edge of state.edges) {
          if (edge.source !== id && edge.target !== id) continue
          /*
           * Must mirror workflow-edge's shouldHighlightEdge exactly: the edge
           * darkens when an endpoint is canvas-selected OR open in the editor
           * panel. If the knob checks fewer conditions than the line, a dark
           * line runs into a light knob.
           */
          const isHighlighted =
            state.nodeInternals.get(edge.source)?.selected ||
            state.nodeInternals.get(edge.target)?.selected ||
            (edge.data as { isConnectedToSelection?: boolean } | undefined)
              ?.isConnectedToSelection ||
            (editorOpenBlockId !== null &&
              (edge.source === editorOpenBlockId || edge.target === editorOpenBlockId))
          if (!isHighlighted) continue
          if (edge.source === id) keys.push(edge.sourceHandle || 'source')
          if (edge.target === id) keys.push(edge.targetHandle || 'target')
        }
        return keys.sort().join('|')
      },
      [id, editorOpenBlockId]
    )
  )
  const highlightedHandles = useMemo(
    () => new Set(highlightedHandleKey ? highlightedHandleKey.split('|') : []),
    [highlightedHandleKey]
  )
  const connectedSourceHandleKey = useReactFlowStore(
    useCallback(
      (state) => {
        const handles = new Set<string>()
        for (const edge of state.edges) {
          if (edge.source === id && isPositionedSourceHandle(edge.sourceHandle)) {
            handles.add(edge.sourceHandle)
          }
        }
        return Array.from(handles).sort().join('|')
      },
      [id]
    )
  )
  const connectedSourceHandles = useMemo(
    () => new Set(connectedSourceHandleKey ? connectedSourceHandleKey.split('|') : []),
    [connectedSourceHandleKey]
  )
  const connectedTargetHandleKey = useReactFlowStore(
    useCallback(
      (state) => {
        const handles = new Set<string>()
        for (const edge of state.edges) {
          if (edge.target === id && isPositionedTargetHandle(edge.targetHandle)) {
            handles.add(edge.targetHandle)
          }
        }
        return Array.from(handles).sort().join('|')
      },
      [id]
    )
  )
  const connectedTargetHandles = useMemo(
    () => new Set(connectedTargetHandleKey ? connectedTargetHandleKey.split('|') : []),
    [connectedTargetHandleKey]
  )

  const errorOutputEnabled = Boolean(currentBlock?.errorEnabled || hasErrorConnection)
  const handleToggleErrorOutput = useCallback(
    (next: boolean) => {
      const store = useWorkflowStore.getState()
      data.onSetErrorOutputEnabled?.(id, next)
      if (!next) {
        /* Turning the branch off removes its connections — a hidden error
           edge would still reroute failures with no visible affordance. */
        const errorEdgeIds = store.edges
          .filter((edge) => edge.source === id && edge.sourceHandle === 'error')
          .map((edge) => edge.id)
        if (errorEdgeIds.length > 0) data.onRemoveEdges?.(errorEdgeIds)
      }
    },
    [data.onRemoveEdges, data.onSetErrorOutputEnabled, id]
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
    const canvasPresentation = resolveCanvasBlockPresentation(config, name, rawValues)

    const visibleSubBlocks = config.subBlocks.filter((block) => {
      if (block.hidden) return false
      if (block.hideFromPreview) return false
      if (hiddenByReactiveCondition.has(block.id)) return false
      if (!isSubBlockFeatureEnabled(block)) return false

      // Configures the block as an agent tool; it has no meaning on the canvas.
      if (isToolInputOnlySubBlock(block)) return false
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

      if (block.condition && !evaluateSubBlockCondition(block.condition, rawValues)) {
        return false
      }

      if (
        canvasPresentation.usesDefaultTitle &&
        block.id === canvasPresentation.operationSubBlockId
      ) {
        return false
      }

      return hasDisplayableRowValue(block, rawValues[block.id])
    })

    const chipBlocks = visibleSubBlocks
      .filter(
        (block) =>
          canvasPresentation.usesDefaultTitle || block.id !== canvasPresentation.operationSubBlockId
      )
      .filter((block) => chipPriority(block) !== null)
      .sort((a, b) => (chipPriority(a) ?? 0) - (chipPriority(b) ?? 0))
      .slice(0, MAX_CHIPS)
    const chipIds = new Set(chipBlocks.map((block) => block.id))
    const rowSubBlocks = visibleSubBlocks.filter((block) => !chipIds.has(block.id))

    rowSubBlocks.forEach((block) => {
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

    return { rows, stateToUse, chipBlocks, canvasPresentation }
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
    name,
  ])

  const subBlockRows = subBlockRowsData.rows
  const subBlockState = subBlockRowsData.stateToUse
  const chipBlocks = subBlockRowsData.chipBlocks
  const canvasPresentation = subBlockRowsData.canvasPresentation
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

  const shouldShowDefaultHandles =
    config.category !== 'triggers' && type !== 'starter' && !displayTriggerMode

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
   * Whether anything renders below the header — subblock rows, chips, or the
   * condition/router branch rows.
   */
  const showsErrorRow = shouldShowDefaultHandles && type !== 'response'
  const hasContentBelowHeader =
    subBlockRows.length > 0 ||
    chipBlocks.length > 0 ||
    conditionRows.length > 0 ||
    routerRows.length > 0 ||
    showsErrorRow

  /**
   * Total rendered row count. `mcp-dynamic-args` expands one row per parameter
   * in the cached tool schema, so we count those properties instead of 1.
   */
  const totalRenderedRowCount = useMemo(() => {
    let count = 0
    for (const row of subBlockRows) {
      for (const subBlock of row) {
        if (subBlock.type === 'mcp-dynamic-args') {
          count += getDisplayableMcpParamNames(
            subBlockState._toolSchema?.value,
            subBlockState[subBlock.id]?.value
          ).length
        } else {
          count += 1
        }
      }
    }
    return count
  }, [subBlockRows, subBlockState])

  /**
   * Natural-language summary data: segments + line estimate for the block
   * types with a sentence template. Null keeps the field-row layout.
   */
  const sentenceData = useMemo(() => {
    if (type === 'condition' || type === 'router_v2') return null
    const visibleSubBlocksById = new Map<string, SubBlockConfig>()
    for (const subBlock of chipBlocks) visibleSubBlocksById.set(subBlock.id, subBlock)
    for (const row of subBlockRows) {
      for (const subBlock of row) visibleSubBlocksById.set(subBlock.id, subBlock)
    }
    const resolve = (...ids: string[]) =>
      ids.find((candidate) => visibleSubBlocksById.has(candidate)) ?? null
    const segments = buildSentenceSegments(type, subBlockState.operation?.value, resolve)
    if (!segments) return null
    const lines = estimateSentenceLines(segments, (subBlockId) =>
      getDisplayValue(subBlockState[subBlockId]?.value)
    )
    return { segments, visibleSubBlocksById, lines }
  }, [type, chipBlocks, subBlockRows, subBlockState])

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
        visibleSubBlockCount: sentenceData ? 0 : totalRenderedRowCount,
        conditionRowCount: conditionRows.length,
        routerRowCount: routerRows.length,
        chipCount: sentenceData ? 0 : chipBlocks.length,
        sentenceLineCount: sentenceData?.lines ?? 0,
        hasErrorRow: showsErrorRow,
      })
    },
    dependencies: [
      type,
      config.category,
      displayTriggerMode,
      totalRenderedRowCount,
      conditionRows.length,
      routerRows.length,
      chipBlocks.length,
      sentenceData?.lines ?? 0,
      Boolean(sentenceData),
      horizontalHandles,
      showsErrorRow,
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

  const getCanvasRowTitle = (subBlock: SubBlockConfig) =>
    subBlock.id === canvasPresentation.operationSubBlockId && !canvasPresentation.usesDefaultTitle
      ? (canvasPresentation.operationRowTitle ?? subBlock.title ?? subBlock.id)
      : (subBlock.title ?? subBlock.id)

  const webhookProviderName = webhookProvider ? getProviderName(webhookProvider) : undefined

  const isBranchBlock = type === 'condition' || type === 'router_v2'

  const sentence = sentenceData ? (
    <>
      {sentenceData.segments.map((segment, index) => {
        if (typeof segment === 'string') {
          const glue = index > 0 && !segment.startsWith(',') && !segment.startsWith('.') ? ' ' : ''
          return <Fragment key={`text-${index}`}>{`${glue}${segment}`}</Fragment>
        }
        const subBlock = sentenceData.visibleSubBlocksById.get(segment.id)
        if (!subBlock) return null
        const rawValue = subBlockState[segment.id]?.value
        return (
          <Fragment key={`value-${index}`}>
            {' '}
            <SubBlockRow
              title={getCanvasRowTitle(subBlock)}
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
              variant='inline-value'
            />
          </Fragment>
        )
      })}
    </>
  ) : undefined

  const chips =
    isBranchBlock || sentenceData || chipBlocks.length === 0 ? undefined : (
      <>
        {chipBlocks.map((subBlock, index) => (
          <Fragment key={`statement-${subBlock.id}`}>
            {index > 0 && <span className='flex-shrink-0 text-[var(--text-muted)] text-sm'>·</span>}
            <SubBlockRow
              title={getCanvasRowTitle(subBlock)}
              value={getDisplayValue(subBlockState[subBlock.id]?.value)}
              subBlock={subBlock}
              rawValue={subBlockState[subBlock.id]?.value}
              workspaceId={workspaceId}
              workflowId={currentWorkflowId}
              blockId={id}
              allSubBlockValues={subBlockState}
              displayAdvancedOptions={effectiveAdvanced}
              canonicalIndex={canonicalIndex}
              canonicalModeOverrides={canonicalModeOverrides}
              variant={subBlock.id === 'operation' ? 'statement-primary' : 'statement-muted'}
            />
          </Fragment>
        ))}
      </>
    )

  const rows =
    type === 'condition' || type === 'router_v2' ? null : (
      <>
        {subBlockRows.map((row, rowIndex) =>
          row.flatMap((subBlock) => {
            const rawValue = subBlockState[subBlock.id]?.value
            if (subBlock.type === 'mcp-dynamic-args') {
              const args = (rawValue && typeof rawValue === 'object' ? rawValue : {}) as Record<
                string,
                unknown
              >
              return getDisplayableMcpParamNames(subBlockState._toolSchema?.value, rawValue).map(
                (paramName) => (
                  <SubBlockRow
                    key={`${subBlock.id}-${paramName}-${rowIndex}`}
                    title={formatParameterLabel(paramName)}
                    value={getDisplayValue(args[paramName])}
                  />
                )
              )
            }
            const metaIcon = getMetaIcon(subBlock)
            return [
              <SubBlockRow
                key={`${subBlock.id}-${rowIndex}`}
                title={getCanvasRowTitle(subBlock)}
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
                variant={metaIcon ? 'meta' : 'row'}
                icon={metaIcon ?? undefined}
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
      name={canvasPresentation.title}
      isPending={isPending}
      isEnabled={isEnabled}
      isLocked={isLocked}
      hasRing={hasRing}
      ringStyles={ringStyles}
      runPathStatus={runPathStatus}
      isRunning={isExecuting}
      isWorkflowRunning={isWorkflowRunning}
      isExecutionHighlighted={isExecutionHighlighted}
      Icon={config.icon}
      iconBgColor={config.bgColor}
      isIntegration={config.category === 'tools'}
      horizontalHandles={horizontalHandles}
      shouldShowDefaultHandles={shouldShowDefaultHandles}
      blockHeight={blockHeight}
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
      canFixSunset={canEditWorkflow && isChatEnabled}
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
          <ActionBar
            blockId={id}
            blockType={type}
            disabled={!canEditWorkflow}
            variant='swell'
            isRunning={isExecuting}
            isWorkflowRunning={isWorkflowRunning}
          />
        ) : undefined
      }
      rows={rows}
      chips={chips}
      typeLabel={canvasPresentation.typeLabel}
      sentence={sentence}
      hasErrorConnection={hasErrorConnection}
      errorOutputEnabled={errorOutputEnabled}
      onToggleErrorOutput={
        canEditWorkflow && data.onSetErrorOutputEnabled ? handleToggleErrorOutput : undefined
      }
      highlightedHandles={highlightedHandles}
      connectedSourceHandles={connectedSourceHandles}
      connectedTargetHandles={connectedTargetHandles}
    />
  )
}, shouldSkipBlockRender)
