'use client'

import { type CSSProperties, memo, useMemo } from 'react'
import {
  CanvasSentenceView,
  HANDLE_POSITIONS,
  humanizeBlockName,
  SubBlockRowView,
  WorkflowTypeTag,
} from '@sim/workflow-renderer'
import { WORKFLOW_SOURCE_HANDLE_ID, WORKFLOW_TARGET_HANDLE_ID } from '@sim/workflow-types/workflow'
import { Handle, type NodeProps, Position } from 'reactflow'
import { resolveCanvasBlockPresentation } from '@/lib/workflows/blocks/canvas-presentation'
import {
  type CardSelector,
  getOperationSubBlockId,
  resolveCanvasSentence,
} from '@/lib/workflows/blocks/canvas-sentence'
import { resolveSelectedTriggerId } from '@/lib/workflows/blocks/canvas-trigger-sentence'
import { resolveCanvasCodePreview } from '@/lib/workflows/blocks/code-preview'
import {
  getDisplayValue,
  hasDisplayableRowValue,
  resolveDropdownLabel,
  resolveSkillsLabel,
  resolveToolsLabel,
  resolveVariablesLabel,
  resolveWorkflowMultiSelectLabel,
  resolveWorkflowSelectionLabel,
} from '@/lib/workflows/subblocks/display'
import {
  buildCanonicalIndexForSurface,
  evaluateSubBlockCondition,
  isSubBlockFeatureEnabled,
  isSubBlockVisibleForMode,
  isToolInputOnlySubBlock,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks'
import { hasBlockAccent } from '@/blocks/accent'
import { SELECTOR_TYPES_HYDRATION_REQUIRED, type SubBlockConfig } from '@/blocks/types'
import { useVariablesStore } from '@/stores/variables/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { TRIGGER_REGISTRY } from '@/triggers/registry'

/** Execution status for blocks in preview mode */
type ExecutionStatus = 'success' | 'error' | 'not-executed'

/** Subblock value structure matching workflow state */
interface SubBlockValueEntry {
  value: unknown
}

/**
 * Handle style constants for preview blocks.
 * Extracted to avoid recreating style objects on each render.
 */
const HANDLE_STYLES = {
  horizontal: '!border-none !bg-[var(--surface-7)] !h-5 !w-[7px] !rounded-xs',
  right:
    '!z-[10] !border-none !bg-[var(--workflow-edge)] !h-5 !w-[7px] !rounded-r-[2px] !rounded-l-none',
  error:
    '!z-[10] !border-none !bg-[var(--text-error)] !h-[7px] !w-6 !rounded-b-[2px] !rounded-t-none',
} as const

/** Reusable style object for error handles positioned at bottom-right */
const ERROR_HANDLE_STYLE: CSSProperties = {
  right: 'auto',
  top: 'auto',
  bottom: '-7px',
  left: 'calc(100% - 30px)',
  transform: 'translateX(-50%)',
}

interface WorkflowPreviewBlockData {
  type: string
  name: string
  workflowMap?: Record<string, WorkflowMetadata>
  workflowLabelsReady?: boolean
  isTrigger?: boolean
  horizontalHandles?: boolean
  enabled?: boolean
  /** Whether this block is selected in preview mode */
  isPreviewSelected?: boolean
  /** Execution status for highlighting error/success states */
  executionStatus?: ExecutionStatus
  /** Subblock values from the workflow state */
  subBlockValues?: Record<string, SubBlockValueEntry | unknown>
  /**
   * Whether the block routes its failures to a second output. The port is the
   * rendered half of that choice, so it only exists when the choice was made —
   * or when an edge already leaves it, which React Flow needs a mounted handle
   * for whatever the flag says.
   */
  errorEnabled?: boolean
  hasErrorConnection?: boolean
  /** Skips expensive subblock computations for thumbnails/template previews */
  lightweight?: boolean
}

/**
 * Extracts the raw value from a subblock value entry.
 * Handles both wrapped ({ value: ... }) and unwrapped formats.
 */
function extractValue(entry: SubBlockValueEntry | unknown): unknown {
  if (entry && typeof entry === 'object' && 'value' in entry) {
    return (entry as SubBlockValueEntry).value
  }
  return entry
}

interface SubBlockRowProps {
  title: string
  value?: string
  subBlock?: SubBlockConfig
  rawValue?: unknown
  workflowMap: Record<string, WorkflowMetadata>
  workflowLabelsReady: boolean
}

/**
 * Resolves a subblock's value to the string the card shows.
 *
 * Shared by the label/value rows and the chips inside a summary sentence so a
 * value cannot render one way in a row and another way inline. The preview is
 * hook-free, so selector types that need an API round-trip resolve to `-`.
 */
function resolvePreviewDisplayValue(
  value: string | undefined,
  subBlock: SubBlockConfig | undefined,
  rawValue: unknown,
  workflowMap: Record<string, WorkflowMetadata>,
  workflowLabelsReady: boolean
): string | undefined {
  const isPasswordField = subBlock?.password === true
  const maskedValue = isPasswordField && value && value !== '-' ? '•••' : null

  const workflowLookup = { workflowMap, ready: workflowLabelsReady }
  const dropdownLabel = resolveDropdownLabel(subBlock, rawValue)
  // Materialize the variables store only for variables-input rows.
  const variablesDisplay =
    subBlock?.type === 'variables-input'
      ? resolveVariablesLabel(
          subBlock,
          rawValue,
          Object.values(useVariablesStore.getState().variables)
        )
      : null
  // Custom tools referenced only by id resolve through their inline
  // schema/registry fallbacks rather than the API.
  const toolsDisplay = resolveToolsLabel(subBlock, rawValue, [])
  const skillsDisplay = resolveSkillsLabel(subBlock, rawValue, [])
  const workflowName = resolveWorkflowSelectionLabel(subBlock, rawValue, workflowLookup)
  const workflowMultiSelectionNames = resolveWorkflowMultiSelectLabel(
    subBlock,
    rawValue,
    workflowLookup
  )

  const isSelectorType = subBlock?.type && SELECTOR_TYPES_HYDRATION_REQUIRED.includes(subBlock.type)

  const hydratedName =
    dropdownLabel ||
    variablesDisplay ||
    toolsDisplay ||
    skillsDisplay ||
    workflowName ||
    workflowMultiSelectionNames

  return maskedValue || hydratedName || (isSelectorType && value ? '-' : value)
}

/**
 * Renders a single subblock row with title and optional value.
 * Matches the SubBlockRow component in WorkflowBlock.
 * - Masks password fields with bullets
 * - Resolves dropdown/combobox labels
 * - Resolves workflow names from registry
 * - Resolves variable names from store
 * - Resolves tool and skill names (registry + stored names; no API access)
 * - Shows '-' for other selector types that need hydration
 */
const SubBlockRow = memo(function SubBlockRow({
  title,
  value,
  subBlock,
  rawValue,
  workflowMap,
  workflowLabelsReady,
}: SubBlockRowProps) {
  const displayValue = resolvePreviewDisplayValue(
    value,
    subBlock,
    rawValue,
    workflowMap,
    workflowLabelsReady
  )

  return (
    <div className='flex h-5 items-center gap-2'>
      <span
        className='min-w-0 truncate text-[var(--text-tertiary)] text-sm capitalize'
        title={title}
      >
        {title}
      </span>
      {displayValue !== undefined && (
        <span
          className='flex-1 truncate text-right text-[var(--text-primary)] text-sm'
          title={displayValue}
        >
          {displayValue}
        </span>
      )}
    </div>
  )
})

/**
 * Preview block component for workflow visualization.
 * Renders block header, subblock values, and handles without
 * hooks, store subscriptions, or interactive features.
 * Matches the visual structure of WorkflowBlock exactly.
 */
function WorkflowPreviewBlockInner({ data }: NodeProps<WorkflowPreviewBlockData>) {
  const {
    type,
    name,
    workflowMap = {},
    workflowLabelsReady = false,
    isTrigger = false,
    enabled = true,
    isPreviewSelected = false,
    executionStatus,
    subBlockValues,
    errorEnabled = false,
    hasErrorConnection = false,
    lightweight = false,
  } = data

  const blockConfig = getBlock(type)
  const effectiveTrigger = isTrigger || type === 'starter'

  const canonicalIndex = useMemo(
    () => buildCanonicalIndexForSurface(blockConfig?.subBlocks || [], effectiveTrigger),
    [blockConfig?.subBlocks, effectiveTrigger]
  )

  const rawValues = useMemo(() => {
    if (lightweight || !subBlockValues) return {}
    return Object.entries(subBlockValues).reduce<Record<string, unknown>>((acc, [key, entry]) => {
      acc[key] = extractValue(entry)
      return acc
    }, {})
  }, [subBlockValues, lightweight])

  const canvasPresentation = useMemo(
    () => (blockConfig ? resolveCanvasBlockPresentation(blockConfig, name, rawValues) : undefined),
    [blockConfig, name, rawValues]
  )

  /**
   * Visible on the card, whether or not it holds a value.
   *
   * A sentence's core slots render either way — the chip shows the field's noun
   * until it is filled — so the sentence needs this set, while the field rows
   * below it need the value-bearing subset.
   */
  const displayableSubBlocks = useMemo(() => {
    if (!blockConfig?.subBlocks) return []

    const isPureTriggerBlock = blockConfig.triggers?.enabled && blockConfig.category === 'triggers'

    return blockConfig.subBlocks.filter((subBlock) => {
      if (subBlock.hidden) return false
      if (subBlock.hideFromPreview) return false
      if (!isSubBlockFeatureEnabled(subBlock)) return false

      // Configures the block as an agent tool; it has no meaning on the canvas.
      if (isToolInputOnlySubBlock(subBlock)) return false

      if (effectiveTrigger) {
        const isValidTriggerSubblock = isPureTriggerBlock
          ? subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced' || !subBlock.mode
          : subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced'
        if (!isValidTriggerSubblock) return false
      } else {
        if (subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced') return false
      }

      /** Skip value-dependent visibility checks in lightweight mode */
      if (lightweight) return !subBlock.condition

      if (!isSubBlockVisibleForMode(subBlock, false, canonicalIndex, rawValues, undefined)) {
        return false
      }
      if (subBlock.condition && !evaluateSubBlockCondition(subBlock.condition, rawValues)) {
        return false
      }
      if (
        canvasPresentation?.titleShowsOperation &&
        subBlock.id === canvasPresentation.operationSubBlockId
      ) {
        return false
      }
      return true
    })
  }, [
    lightweight,
    blockConfig?.subBlocks,
    blockConfig?.triggers?.enabled,
    blockConfig?.category,
    effectiveTrigger,
    canonicalIndex,
    rawValues,
    canvasPresentation,
  ])

  /**
   * The definition this operation shows, by id.
   *
   * Doubles as the chip lookup, which used to rescan `visibleSubBlocks` for
   * every slot on every render of every previewed card.
   */
  const onCardById = useMemo(() => {
    const byId = new Map<string, SubBlockConfig>()
    for (const subBlock of displayableSubBlocks) {
      if (!byId.has(subBlock.id)) byId.set(subBlock.id, subBlock)
    }
    return byId
  }, [displayableSubBlocks])

  /* Lightweight mode has no values to test, so it keeps every displayable row. */
  const visibleSubBlocks = useMemo(
    () =>
      lightweight
        ? displayableSubBlocks
        : displayableSubBlocks.filter((subBlock) =>
            hasDisplayableRowValue(subBlock, rawValues[subBlock.id])
          ),
    [lightweight, displayableSubBlocks, rawValues]
  )

  /**
   * The block's natural-language summary, which replaces its field rows.
   *
   * Resolved against the same visible-and-configured set the rows use, so the
   * preview reaches the same sentence the editor canvas paints. Skipped in
   * lightweight mode, which has no values to resolve chips from.
   */
  const sentenceSegments = useMemo(() => {
    if (lightweight || !blockConfig) return null
    if (type === 'condition' || type === 'router_v2' || type === 'starter') return null

    const availableIds = new Set(visibleSubBlocks.map((subBlock) => subBlock.id))
    const operationSubBlockId = getOperationSubBlockId(blockConfig)
    const card: CardSelector = effectiveTrigger
      ? (() => {
          const triggerId = resolveSelectedTriggerId(blockConfig, rawValues)
          return {
            mode: 'trigger' as const,
            triggerId,
            triggerName: triggerId ? (TRIGGER_REGISTRY[triggerId]?.name ?? null) : null,
          }
        })()
      : {
          mode: 'action',
          operationValue: operationSubBlockId ? rawValues[operationSubBlockId] : undefined,
        }

    return resolveCanvasSentence(
      blockConfig,
      card,
      (subBlockId) => availableIds.has(subBlockId),
      (subBlockId) => onCardById.get(subBlockId) ?? null
    )
  }, [lightweight, blockConfig, type, effectiveTrigger, visibleSubBlocks, onCardById, rawValues])

  /**
   * Compute condition rows for condition blocks.
   * In lightweight mode, returns default structure without parsing values.
   */
  const conditionRows = useMemo(() => {
    if (type !== 'condition') return []

    /** Default structure for lightweight mode or when no values */
    const defaultRows = [
      { id: 'if', title: 'if', value: '' },
      { id: 'else', title: 'else', value: '' },
    ]

    if (lightweight) return defaultRows

    const conditionsValue = rawValues.conditions
    const raw = typeof conditionsValue === 'string' ? conditionsValue : undefined

    try {
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          return parsed.map((item: unknown, index: number) => {
            const conditionItem = item as { id?: string; value?: unknown }
            const title = index === 0 ? 'if' : index === parsed.length - 1 ? 'else' : 'else if'
            return {
              id: conditionItem?.id ?? `cond-${index}`,
              title,
              value: typeof conditionItem?.value === 'string' ? conditionItem.value : '',
            }
          })
        }
      }
    } catch {
      /* empty */
    }

    return defaultRows
  }, [type, rawValues, lightweight])

  /**
   * Compute router rows for router_v2 blocks.
   * In lightweight mode, returns default structure without parsing values.
   */
  const routerRows = useMemo(() => {
    if (type !== 'router_v2') return []

    /** Default structure for lightweight mode or when no values */
    const defaultRows = [{ id: 'route1', value: '' }]

    if (lightweight) return defaultRows

    const routesValue = rawValues.routes
    const raw = typeof routesValue === 'string' ? routesValue : undefined

    try {
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          return parsed.map((item: unknown, index: number) => {
            const routeItem = item as { id?: string; value?: string }
            return {
              id: routeItem?.id ?? `route${index + 1}`,
              value: routeItem?.value ?? '',
            }
          })
        }
      }
    } catch {
      /* empty */
    }

    return defaultRows
  }, [type, rawValues, lightweight])

  if (!blockConfig || !canvasPresentation) {
    return null
  }

  const IconComponent = blockConfig.icon
  const isStarterOrTrigger = blockConfig.category === 'triggers' || type === 'starter' || isTrigger
  const isNoteBlock = type === 'note'

  const shouldShowDefaultHandles = !isStarterOrTrigger && !isNoteBlock
  const hasSubBlocks = visibleSubBlocks.length > 0
  /*
   * Gated on rows the preview actually renders. The error row that used to be
   * the guaranteed content for every non-trigger block is gone, so keeping
   * `shouldShowDefaultHandles` in this test painted an empty padded band under
   * the header of any unconfigured block — content the editor canvas, which
   * derives this from its real sections, never shows.
   */
  const hasContentBelowHeader =
    type === 'condition'
      ? conditionRows.length > 0
      : type === 'router_v2'
        ? /* The Context row renders whether or not any routes are defined. */
          true
        : /* A sentence built only from literals resolves no field, so it
             contributes no rows but still paints. */
          sentenceSegments !== null || hasSubBlocks

  const hasError = executionStatus === 'error'
  const hasSuccess = executionStatus === 'success'

  return (
    <div className='relative w-[250px] select-none rounded-2xl border-[1.5px] border-[var(--border-1)] bg-[var(--surface-2)]'>
      {/* Selection ring overlay (takes priority over execution rings) */}
      {isPreviewSelected && (
        <div className='pointer-events-none absolute inset-0 z-40 rounded-2xl ring-[1.5px] ring-[var(--text-secondary)]' />
      )}
      {/* Success ring overlay (only shown if not selected) */}
      {!isPreviewSelected && hasSuccess && (
        <div className='pointer-events-none absolute inset-0 z-40 rounded-2xl ring-[1.5px] ring-[var(--brand-accent)]' />
      )}
      {/* Error ring overlay (only shown if not selected) */}
      {!isPreviewSelected && hasError && (
        <div className='pointer-events-none absolute inset-0 z-40 rounded-2xl ring-[1.5px] ring-[var(--text-error)]' />
      )}

      {/* Target handle - not shown for triggers/starters */}
      {shouldShowDefaultHandles && (
        <Handle
          type='target'
          position={Position.Left}
          id={WORKFLOW_TARGET_HANDLE_ID}
          className={HANDLE_STYLES.horizontal}
          style={{ left: '-7px', top: '50%', transform: 'translateY(-50%)' }}
        />
      )}

      {/* Header - matches WorkflowBlock structure */}
      <div className='flex h-[40px] items-center justify-between px-2'>
        <div className='relative z-10 flex min-w-0 flex-1 items-center'>
          <span
            className={`truncate text-[17px] ${!enabled ? 'text-[var(--text-muted)]' : ''}`}
            title={canvasPresentation.title}
          >
            {humanizeBlockName(canvasPresentation.title)}
          </span>
        </div>
        {!isNoteBlock && (
          <WorkflowTypeTag
            type={type}
            typeLabel={canvasPresentation.typeLabel}
            Icon={IconComponent}
            iconBgColor={blockConfig.bgColor}
            isIntegration={!hasBlockAccent(type)}
            isEnabled={enabled}
          />
        )}
      </div>

      {/* Content area with subblocks */}
      {hasContentBelowHeader && (
        <div className='flex flex-col gap-2 p-2'>
          {type === 'condition' ? (
            conditionRows.map((cond) => (
              <SubBlockRow
                key={cond.id}
                title={cond.title}
                value={lightweight ? undefined : getDisplayValue(cond.value)}
                workflowMap={workflowMap}
                workflowLabelsReady={workflowLabelsReady}
              />
            ))
          ) : sentenceSegments ? (
            <CanvasSentenceView
              segments={sentenceSegments}
              renderChip={(subBlockId) => {
                const subBlock = onCardById.get(subBlockId)
                if (!subBlock) return null
                const rawValue = rawValues[subBlockId]
                const displayValue = resolvePreviewDisplayValue(
                  getDisplayValue(rawValue),
                  subBlock,
                  rawValue,
                  workflowMap,
                  workflowLabelsReady
                )
                /* The preview has no hooks, so a selector it cannot hydrate comes
                   back as the `-` sentinel. That reads as noise mid-sentence, so
                   hand the slot back and let its noun stand in instead. */
                if (!displayValue || displayValue === '-') return null
                return (
                  <SubBlockRowView
                    title={subBlock.title ?? subBlock.id}
                    displayValue={displayValue}
                    codePreview={resolveCanvasCodePreview(subBlock, rawValue, rawValues)}
                    variant='inline-value'
                  />
                )
              }}
            />
          ) : type === 'router_v2' ? (
            <>
              <SubBlockRow
                key='context'
                title='Context'
                value={lightweight ? undefined : getDisplayValue(rawValues.context)}
                workflowMap={workflowMap}
                workflowLabelsReady={workflowLabelsReady}
              />
              {routerRows.map((route, index) => (
                <SubBlockRow
                  key={route.id}
                  title={`Route ${index + 1}`}
                  value={lightweight ? undefined : getDisplayValue(route.value)}
                  workflowMap={workflowMap}
                  workflowLabelsReady={workflowLabelsReady}
                />
              ))}
            </>
          ) : (
            visibleSubBlocks.map((subBlock) => {
              const rawValue = lightweight ? undefined : rawValues[subBlock.id]
              return (
                <SubBlockRow
                  key={subBlock.id}
                  title={
                    subBlock.id === canvasPresentation.operationSubBlockId &&
                    !canvasPresentation.titleShowsOperation
                      ? (canvasPresentation.operationRowTitle ?? subBlock.title ?? subBlock.id)
                      : (subBlock.title ?? subBlock.id)
                  }
                  value={lightweight ? undefined : getDisplayValue(rawValue)}
                  subBlock={lightweight ? undefined : subBlock}
                  rawValue={rawValue}
                  workflowMap={workflowMap}
                  workflowLabelsReady={workflowLabelsReady}
                />
              )
            })
          )}
        </div>
      )}

      {/* Condition block handles */}
      {type === 'condition' && (
        <>
          {conditionRows.map((cond, condIndex) => {
            const topOffset =
              HANDLE_POSITIONS.CONDITION_START_Y + condIndex * HANDLE_POSITIONS.CONDITION_ROW_HEIGHT
            return (
              <Handle
                key={`handle-${cond.id}`}
                type='source'
                position={Position.Right}
                id={`condition-${cond.id}`}
                className={HANDLE_STYLES.right}
                style={{ top: `${topOffset}px`, right: '-7px', transform: 'translateY(-50%)' }}
              />
            )
          })}
        </>
      )}

      {/* Router block handles */}
      {type === 'router_v2' && (
        <>
          {routerRows.map((route, routeIndex) => {
            const topOffset =
              HANDLE_POSITIONS.CONDITION_START_Y +
              (routeIndex + 1) * HANDLE_POSITIONS.CONDITION_ROW_HEIGHT
            return (
              <Handle
                key={`handle-${route.id}`}
                type='source'
                position={Position.Right}
                id={`router-${route.id}`}
                className={HANDLE_STYLES.right}
                style={{ top: `${topOffset}px`, right: '-7px', transform: 'translateY(-50%)' }}
              />
            )
          })}
        </>
      )}

      {/* Source and error handles for non-condition/router/note blocks */}
      {type !== 'condition' && type !== 'router_v2' && type !== 'response' && !isNoteBlock && (
        <Handle
          type='source'
          position={Position.Right}
          id={WORKFLOW_SOURCE_HANDLE_ID}
          className={HANDLE_STYLES.right}
          style={{ right: '-7px', top: '50%', transform: 'translateY(-50%)' }}
        />
      )}

      {/* The editor canvas gates this the same way — the port is the rendered
          half of the error-output toggle, and a card that never opted in should
          not grow one. An existing error edge keeps it mounted regardless, or
          React Flow would drop that edge for having no handle to leave from. */}
      {shouldShowDefaultHandles && type !== 'response' && (errorEnabled || hasErrorConnection) && (
        <Handle
          type='source'
          position={Position.Bottom}
          id='error'
          className={HANDLE_STYLES.error}
          style={ERROR_HANDLE_STYLE}
        />
      )}
    </div>
  )
}

/**
 * Custom comparison function for React.memo optimization.
 * Uses fast-path primitive comparison before shallow comparing subBlockValues.
 * @param prevProps - Previous render props
 * @param nextProps - Next render props
 * @returns True if render should be skipped (props are equal)
 */
function shouldSkipPreviewBlockRender(
  prevProps: NodeProps<WorkflowPreviewBlockData>,
  nextProps: NodeProps<WorkflowPreviewBlockData>
): boolean {
  if (
    prevProps.id !== nextProps.id ||
    prevProps.data.type !== nextProps.data.type ||
    prevProps.data.name !== nextProps.data.name ||
    prevProps.data.isTrigger !== nextProps.data.isTrigger ||
    prevProps.data.enabled !== nextProps.data.enabled ||
    prevProps.data.isPreviewSelected !== nextProps.data.isPreviewSelected ||
    prevProps.data.executionStatus !== nextProps.data.executionStatus ||
    prevProps.data.errorEnabled !== nextProps.data.errorEnabled ||
    prevProps.data.hasErrorConnection !== nextProps.data.hasErrorConnection ||
    prevProps.data.lightweight !== nextProps.data.lightweight
  ) {
    return false
  }

  /** Skip subBlockValues comparison in lightweight mode */
  if (nextProps.data.lightweight) return true

  const prevValues = prevProps.data.subBlockValues
  const nextValues = nextProps.data.subBlockValues

  if (prevValues === nextValues) return true
  if (!prevValues || !nextValues) return false

  const prevKeys = Object.keys(prevValues)
  const nextKeys = Object.keys(nextValues)

  if (prevKeys.length !== nextKeys.length) return false

  for (const key of prevKeys) {
    if (prevValues[key] !== nextValues[key]) return false
  }

  return true
}

/**
 * Preview block component for workflow visualization in readonly contexts.
 * Optimized for rendering without hooks or store subscriptions.
 *
 * @remarks
 * - Renders block header, subblock values, and connection handles
 * - Supports condition, router, and standard block types
 * - Shows error handles for non-trigger blocks
 * - Displays execution status via colored ring overlays
 */
export const PreviewBlock = memo(WorkflowPreviewBlockInner, shouldSkipPreviewBlockRender)
