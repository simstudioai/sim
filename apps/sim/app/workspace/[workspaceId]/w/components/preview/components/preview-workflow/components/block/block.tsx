'use client'

import { type CSSProperties, memo, useMemo } from 'react'
import { HANDLE_POSITIONS } from '@sim/workflow-renderer'
import { Handle, type NodeProps, Position } from 'reactflow'
import {
  getDisplayValue,
  resolveDropdownLabel,
  resolveSkillsLabel,
  resolveToolsLabel,
  resolveVariablesLabel,
  resolveWorkflowMultiSelectLabel,
  resolveWorkflowSelectionLabel,
} from '@/lib/workflows/subblocks/display'
import {
  buildCanonicalIndex,
  evaluateSubBlockCondition,
  isSubBlockFeatureEnabled,
  isSubBlockVisibleForMode,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks'
import { getTileIconColorClass } from '@/blocks/icon-color'
import { SELECTOR_TYPES_HYDRATION_REQUIRED, type SubBlockConfig } from '@/blocks/types'
import { useVariablesStore } from '@/stores/variables/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

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
  vertical: '!border-none !bg-[var(--surface-7)] !h-[7px] !w-5 !rounded-xs',
  right:
    '!z-[10] !border-none !bg-[var(--workflow-edge)] !h-5 !w-[7px] !rounded-r-[2px] !rounded-l-none',
  error:
    '!z-[10] !border-none !bg-[var(--text-error)] !h-5 !w-[7px] !rounded-r-[2px] !rounded-l-none',
} as const

/** Reusable style object for error handles positioned at bottom-right */
const ERROR_HANDLE_STYLE: CSSProperties = {
  right: '-7px',
  top: 'auto',
  bottom: `${HANDLE_POSITIONS.ERROR_BOTTOM_OFFSET}px`,
  transform: 'translateY(50%)',
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
  // The preview is hook-free, so custom tools referenced only by id resolve
  // through their inline schema/registry fallbacks rather than the API.
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
  const displayValue = maskedValue || hydratedName || (isSelectorType && value ? '-' : value)

  return (
    <div className='flex items-center gap-2'>
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
    horizontalHandles = false,
    enabled = true,
    isPreviewSelected = false,
    executionStatus,
    subBlockValues,
    lightweight = false,
  } = data

  const blockConfig = getBlock(type)

  const canonicalIndex = useMemo(
    () => buildCanonicalIndex(blockConfig?.subBlocks || []),
    [blockConfig?.subBlocks]
  )

  const rawValues = useMemo(() => {
    if (lightweight || !subBlockValues) return {}
    return Object.entries(subBlockValues).reduce<Record<string, unknown>>((acc, [key, entry]) => {
      acc[key] = extractValue(entry)
      return acc
    }, {})
  }, [subBlockValues, lightweight])

  const visibleSubBlocks = useMemo(() => {
    if (!blockConfig?.subBlocks) return []

    const isPureTriggerBlock = blockConfig.triggers?.enabled && blockConfig.category === 'triggers'
    const effectiveTrigger = isTrigger || type === 'starter'

    return blockConfig.subBlocks.filter((subBlock) => {
      if (subBlock.hidden) return false
      if (subBlock.hideFromPreview) return false
      if (!isSubBlockFeatureEnabled(subBlock)) return false

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
      if (!subBlock.condition) return true
      return evaluateSubBlockCondition(subBlock.condition, rawValues)
    })
  }, [
    lightweight,
    blockConfig?.subBlocks,
    blockConfig?.triggers?.enabled,
    blockConfig?.category,
    type,
    isTrigger,
    canonicalIndex,
    rawValues,
  ])

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

  if (!blockConfig) {
    return null
  }

  const IconComponent = blockConfig.icon
  const isStarterOrTrigger = blockConfig.category === 'triggers' || type === 'starter' || isTrigger
  const isNoteBlock = type === 'note'

  const shouldShowDefaultHandles = !isStarterOrTrigger && !isNoteBlock
  const hasSubBlocks = visibleSubBlocks.length > 0
  const hasContentBelowHeader =
    type === 'condition'
      ? conditionRows.length > 0 || shouldShowDefaultHandles
      : type === 'router_v2'
        ? routerRows.length > 0 || shouldShowDefaultHandles
        : hasSubBlocks || shouldShowDefaultHandles

  const hasError = executionStatus === 'error'
  const hasSuccess = executionStatus === 'success'

  return (
    <div className='relative w-[250px] select-none rounded-lg border border-[var(--border-1)] bg-[var(--surface-2)]'>
      {/* Selection ring overlay (takes priority over execution rings) */}
      {isPreviewSelected && (
        <div className='pointer-events-none absolute inset-0 z-40 rounded-lg ring-[1.75px] ring-[var(--brand-secondary)]' />
      )}
      {/* Success ring overlay (only shown if not selected) */}
      {!isPreviewSelected && hasSuccess && (
        <div className='pointer-events-none absolute inset-0 z-40 rounded-lg ring-[1.75px] ring-[var(--brand-accent)]' />
      )}
      {/* Error ring overlay (only shown if not selected) */}
      {!isPreviewSelected && hasError && (
        <div className='pointer-events-none absolute inset-0 z-40 rounded-lg ring-[1.75px] ring-[var(--text-error)]' />
      )}

      {/* Target handle - not shown for triggers/starters */}
      {shouldShowDefaultHandles && (
        <Handle
          type='target'
          position={horizontalHandles ? Position.Left : Position.Top}
          id='target'
          className={horizontalHandles ? HANDLE_STYLES.horizontal : HANDLE_STYLES.vertical}
          style={
            horizontalHandles
              ? { left: '-7px', top: `${HANDLE_POSITIONS.DEFAULT_Y_OFFSET}px` }
              : { top: '-7px', left: '50%', transform: 'translateX(-50%)' }
          }
        />
      )}

      {/* Header - matches WorkflowBlock structure */}
      <div
        className={`flex items-center justify-between p-2 ${hasContentBelowHeader ? 'border-[var(--border-1)] border-b' : ''}`}
      >
        <div className='relative z-10 flex min-w-0 flex-1 items-center gap-2.5'>
          {!isNoteBlock && (
            <div
              className='flex size-[24px] flex-shrink-0 items-center justify-center rounded-md'
              style={{ background: enabled ? blockConfig.bgColor : 'gray' }}
            >
              <IconComponent
                className={`size-[16px] ${enabled ? getTileIconColorClass(blockConfig.bgColor) : 'text-[var(--text-icon)]'}`}
              />
            </div>
          )}
          <span
            className={`truncate font-medium text-md ${!enabled ? 'text-[var(--text-muted)]' : ''}`}
            title={name}
          >
            {name}
          </span>
        </div>
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
                  title={subBlock.title ?? subBlock.id}
                  value={lightweight ? undefined : getDisplayValue(rawValue)}
                  subBlock={lightweight ? undefined : subBlock}
                  rawValue={rawValue}
                  workflowMap={workflowMap}
                  workflowLabelsReady={workflowLabelsReady}
                />
              )
            })
          )}
          {/* Error row for non-trigger blocks */}
          {shouldShowDefaultHandles && (
            <SubBlockRow
              title='error'
              workflowMap={workflowMap}
              workflowLabelsReady={workflowLabelsReady}
            />
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
          <Handle
            type='source'
            position={Position.Right}
            id='error'
            className={HANDLE_STYLES.error}
            style={ERROR_HANDLE_STYLE}
          />
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
          <Handle
            type='source'
            position={Position.Right}
            id='error'
            className={HANDLE_STYLES.error}
            style={ERROR_HANDLE_STYLE}
          />
        </>
      )}

      {/* Source and error handles for non-condition/router/note blocks */}
      {type !== 'condition' && type !== 'router_v2' && type !== 'response' && !isNoteBlock && (
        <>
          <Handle
            type='source'
            position={horizontalHandles ? Position.Right : Position.Bottom}
            id='source'
            className={horizontalHandles ? HANDLE_STYLES.right : HANDLE_STYLES.vertical}
            style={
              horizontalHandles
                ? { right: '-7px', top: `${HANDLE_POSITIONS.DEFAULT_Y_OFFSET}px` }
                : { bottom: '-7px', left: '50%', transform: 'translateX(-50%)' }
            }
          />
          {shouldShowDefaultHandles && (
            <Handle
              type='source'
              position={Position.Right}
              id='error'
              className={HANDLE_STYLES.error}
              style={ERROR_HANDLE_STYLE}
            />
          )}
        </>
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
    prevProps.data.horizontalHandles !== nextProps.data.horizontalHandles ||
    prevProps.data.enabled !== nextProps.data.enabled ||
    prevProps.data.isPreviewSelected !== nextProps.data.isPreviewSelected ||
    prevProps.data.executionStatus !== nextProps.data.executionStatus ||
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
