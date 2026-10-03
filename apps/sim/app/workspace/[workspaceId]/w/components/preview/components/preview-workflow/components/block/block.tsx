'use client'

import { type CSSProperties, memo, useMemo } from 'react'
import { cn, OverflowText } from '@sim/emcn'
import {
  CanvasSentenceView,
  humanizeBlockName,
  SubBlockRowView,
  WorkflowTypeTag,
} from '@sim/workflow-renderer'
import {
  WORKFLOW_ERROR_HANDLE_ID,
  WORKFLOW_SOURCE_HANDLE_ID,
  WORKFLOW_TARGET_HANDLE_ID,
} from '@sim/workflow-types/workflow'
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react'
import { type CanvasPort, getCanvasPorts } from '@/lib/workflows/blocks/canvas-ports'
import { resolveCanvasBlockPresentation } from '@/lib/workflows/blocks/canvas-presentation'
import {
  type CardSelector,
  getOperationSubBlockId,
  resolveCanvasSentence,
} from '@/lib/workflows/blocks/canvas-sentence'
import { resolveSelectedTriggerId } from '@/lib/workflows/blocks/canvas-trigger-sentence'
import { resolveCanvasCodePreview } from '@/lib/workflows/blocks/code-preview'
import type { BlockDiffStatus } from '@/lib/workflows/comparison'
import {
  getDisplayValue,
  hasDisplayableRowValue,
  resolveDropdownLabel,
  resolveFallbackModelsLabel,
  resolveFolderPathLabel,
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
import { DiffStatusLabel } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/components/diff-label/diff-label'
import { PreviewPortRows } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/components/port-rows/port-rows'
import {
  getPreviewPortRows,
  PREVIEW_CARD_BORDER_WIDTH,
} from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/preview-ports'
import { usePreviewPortInternals } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/use-preview-port-internals'
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
  horizontal: 'border-none! bg-[var(--surface-7)]! h-5! w-[7px]! rounded-xs!',
  right:
    'z-[10]! border-none! bg-[var(--workflow-edge)]! h-5! w-[7px]! rounded-r-[2px]! rounded-l-none!',
  error:
    'z-[10]! border-none! bg-[var(--text-error)]! h-[7px]! w-6! rounded-b-[2px]! rounded-t-none!',
} as const

/** Reusable style object for error handles positioned at bottom-right */
const ERROR_HANDLE_STYLE: CSSProperties = {
  right: 'auto',
  top: 'auto',
  bottom: '-7px',
  left: 'calc(100% - 30px)',
  transform: 'translateX(-50%)',
}

interface WorkflowPreviewBlockData extends Record<string, unknown> {
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
  /** Comparison status when previewing a version diff */
  diffStatus?: BlockDiffStatus
  /** Sub-block ids the comparison reported as changed on this block */
  changedFields?: string[]
  removedPorts?: CanvasPort[]
}

/** A removed card fades instead of ringing, so only the live statuses have a ring. */
const DIFF_RING_CLASS: Record<Exclude<BlockDiffStatus, 'removed'>, string> = {
  added: 'ring-[var(--brand-accent)]',
  modified: 'ring-[var(--warning)]',
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
  /** The comparison reported this field as changed; tint the row */
  changed?: boolean
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
  const fallbackModelsDisplay = resolveFallbackModelsLabel(subBlock, rawValue)
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
    fallbackModelsDisplay ||
    workflowName ||
    workflowMultiSelectionNames ||
    /*
     * A type in SELECTOR_TYPES_HYDRATION_REQUIRED with no resolver here falls to
     * the placeholder below, so a picked folder read as "you picked nothing".
     * Same decode the canvas card and the workflow diff use, and it needs no
     * hook or fetch, which is what lets it sit in this hook-free resolver.
     */
    resolveFolderPathLabel(subBlock, rawValue)

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
  changed = false,
}: SubBlockRowProps) {
  const displayValue = resolvePreviewDisplayValue(
    value,
    subBlock,
    rawValue,
    workflowMap,
    workflowLabelsReady
  )

  return (
    <div
      className={cn(
        'flex h-5 items-center gap-2',
        changed && '-mx-1 rounded-sm bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] px-1'
      )}
    >
      <OverflowText label={title} className='text-[var(--text-tertiary)] text-sm capitalize' />
      {displayValue !== undefined && (
        <OverflowText
          label={displayValue}
          className='flex-1 text-right text-[var(--text-primary)] text-sm'
        />
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
type WorkflowPreviewBlockNode = Node<WorkflowPreviewBlockData, 'workflowBlock' | 'noteBlock'>

function WorkflowPreviewBlockInner({ id, data }: NodeProps<WorkflowPreviewBlockNode>) {
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
    diffStatus,
    changedFields,
    removedPorts,
  } = data
  const changedFieldSet = new Set(changedFields)

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

  const portBlock = {
    id,
    type,
    triggerMode: isTrigger,
    errorEnabled,
    subBlocks: {
      conditions: { value: extractValue(subBlockValues?.conditions) },
      routes: { value: extractValue(subBlockValues?.routes) },
      context: { value: extractValue(subBlockValues?.context) },
    },
  }
  const ports = getCanvasPorts(portBlock, hasErrorConnection)
  const portRows = getPreviewPortRows(portBlock, removedPorts)
  usePreviewPortInternals(id, [...ports, ...(removedPorts ?? [])])
  const isBranchBlock = type === 'condition' || type === 'router_v2'

  if (!blockConfig || !canvasPresentation) {
    return null
  }

  const IconComponent = blockConfig.icon
  const isNoteBlock = type === 'note'
  const mountedHandles = new Set(ports.map((port) => port.handleId))
  const hasSubBlocks = visibleSubBlocks.length > 0
  const hasContentBelowHeader = !isBranchBlock && (sentenceSegments !== null || hasSubBlocks)

  const hasError = executionStatus === 'error'
  const hasSuccess = executionStatus === 'success'
  const isRemoved = diffStatus === 'removed'

  return (
    <div
      style={{ '--preview-border-width': `${PREVIEW_CARD_BORDER_WIDTH}px` } as CSSProperties}
      className={cn(
        'relative w-[250px] select-none rounded-2xl border-[length:var(--preview-border-width)] border-[var(--border)] bg-[var(--surface-2)]',
        /* Ghost: the same card, just faded, so the eye reads "used to be here" not "broken". */
        isRemoved &&
          'border-[var(--border)] bg-[var(--surface-1)] [&>[data-ghost-content]]:opacity-45'
      )}
    >
      {/* Comparison label above the card */}
      {diffStatus && <DiffStatusLabel status={diffStatus} />}
      {/* Selection ring overlay (takes priority over execution rings) */}
      {isPreviewSelected && (
        <div className='pointer-events-none absolute inset-0 z-40 rounded-2xl ring-[1.5px] ring-[var(--text-secondary)]' />
      )}
      {/* Comparison ring overlay */}
      {!isPreviewSelected && diffStatus && diffStatus !== 'removed' && (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 z-40 rounded-2xl ring-[1.5px]',
            DIFF_RING_CLASS[diffStatus]
          )}
        />
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
      {mountedHandles.has(WORKFLOW_TARGET_HANDLE_ID) && (
        <Handle
          type='target'
          position={Position.Left}
          id={WORKFLOW_TARGET_HANDLE_ID}
          className={HANDLE_STYLES.horizontal}
          style={{ left: '-7px', top: '50%', transform: 'translateY(-50%)' }}
        />
      )}

      {/* Header - matches WorkflowBlock structure */}
      <div data-ghost-content='' className='flex h-[40px] items-center justify-between px-2'>
        <div className='relative z-10 flex min-w-0 flex-1 items-center'>
          <OverflowText
            label={humanizeBlockName(canvasPresentation.title)}
            className={!enabled ? 'text-[17px] text-[var(--text-muted)]' : 'text-[17px]'}
          />
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
        <div data-ghost-content='' className='flex flex-col gap-2 p-2'>
          {sentenceSegments ? (
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
                const chip = (
                  <SubBlockRowView
                    title={subBlock.title ?? subBlock.id}
                    displayValue={displayValue}
                    codePreview={resolveCanvasCodePreview(subBlock, rawValue, rawValues)}
                    variant='inline-value'
                  />
                )
                if (!changedFieldSet.has(subBlockId)) return chip
                /* The chip, not the sentence, is what changed. */
                return (
                  <span className='rounded-sm bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--warning)_45%,transparent)]'>
                    {chip}
                  </span>
                )
              }}
            />
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
                  changed={changedFieldSet.has(subBlock.id)}
                />
              )
            })
          )}
        </div>
      )}

      <div data-ghost-content=''>
        <PreviewPortRows
          rows={portRows}
          changedFields={changedFieldSet}
          lightweight={lightweight}
          borderWidth={PREVIEW_CARD_BORDER_WIDTH}
        />
      </div>

      {/* Source and error handles for non-condition/router/note blocks */}
      {mountedHandles.has(WORKFLOW_SOURCE_HANDLE_ID) && (
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
      {mountedHandles.has(WORKFLOW_ERROR_HANDLE_ID) && (
        <Handle
          type='source'
          position={Position.Bottom}
          id={WORKFLOW_ERROR_HANDLE_ID}
          className={HANDLE_STYLES.error}
          style={ERROR_HANDLE_STYLE}
        />
      )}
    </div>
  )
}

/** Same changed-field list, by identity first so the common unchanged case costs nothing. */
function sameFields(prev: string[] | undefined, next: string[] | undefined): boolean {
  if (prev === next) return true
  if (!prev || !next || prev.length !== next.length) return false
  return prev.every((field, index) => field === next[index])
}

/**
 * Custom comparison function for React.memo optimization.
 * Uses fast-path primitive comparison before shallow comparing subBlockValues.
 * @param prevProps - Previous render props
 * @param nextProps - Next render props
 * @returns True if render should be skipped (props are equal)
 */
function shouldSkipPreviewBlockRender(
  prevProps: NodeProps<WorkflowPreviewBlockNode>,
  nextProps: NodeProps<WorkflowPreviewBlockNode>
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
    prevProps.data.lightweight !== nextProps.data.lightweight ||
    prevProps.data.diffStatus !== nextProps.data.diffStatus ||
    prevProps.data.removedPorts !== nextProps.data.removedPorts ||
    !sameFields(prevProps.data.changedFields, nextProps.data.changedFields)
  ) {
    return false
  }

  if (
    prevProps.data.workflowMap !== nextProps.data.workflowMap ||
    prevProps.data.workflowLabelsReady !== nextProps.data.workflowLabelsReady
  ) {
    return false
  }

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
