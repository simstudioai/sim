'use client'

import { type ComponentType, memo, useContext } from 'react'
import { cn } from '@sim/emcn'
import {
  type CanvasSentenceSegment,
  CanvasSentenceView,
  SubBlockRowView,
  WorkflowBlockView,
} from '@sim/workflow-renderer'
import type { Node, NodeProps } from '@xyflow/react'
import { m } from 'framer-motion'
import { normalizeBlockType, resolveIcon } from '@/components/workflow-preview/block-icons'
import { PreviewSelectionContext } from '@/components/workflow-preview/preview-selection-context'
import {
  BLOCK_STAGGER,
  DIMMED_PREVIEW_CLASS,
  EASE_OUT,
  type PreviewTool,
} from '@/components/workflow-preview/workflow-data'

/** Renders the colored square with no glyph when a block type has no registered icon. */
const EMPTY_ICON: ComponentType<{ className?: string }> = () => null

const RING_STYLES = 'ring-[1.5px] ring-[var(--text-secondary)]'

export interface DocsBlockData extends Record<string, unknown> {
  name: string
  blockType: string
  bgColor: string
  rows: Array<{ title: string; value: string }>
  sentence?: readonly CanvasSentenceSegment[]
  typeLabel?: string
  isIntegration?: boolean
  triggerMode?: boolean
  hasErrorConnection?: boolean
  branches?: Array<{ id: string; label: string; value?: string }>
  tools?: PreviewTool[]
  hideTargetHandle?: boolean
  index?: number
  animate?: boolean
  isHighlighted?: boolean
  isDimmed?: boolean
}

export type DocsBlockNodeType = Node<DocsBlockData, 'previewBlock'>

/**
 * Docs adapter for workflow block nodes: maps the static preview data to the
 * shared {@link WorkflowBlockView}'s props. Carries no stores or
 * queries — it only reshapes data into View props and wraps the result in the
 * stagger motion used by the rest of the diagram (the parent
 * `WorkflowPreview` provides the `LazyMotion` feature set). The block's ring is
 * driven by `hasRing`/`ringStyles` inside the View.
 */
export const DocsBlockNode = memo(function DocsBlockNode({
  id,
  data,
}: NodeProps<DocsBlockNodeType>) {
  const selectBlock = useContext(PreviewSelectionContext)
  const {
    name,
    blockType,
    bgColor,
    rows: dataRows,
    branches,
    tools,
    hideTargetHandle = false,
    index = 0,
    animate = false,
    isHighlighted = false,
    isDimmed = false,
  } = data

  /** The View gates router handle topology on `type === 'router_v2'`. */
  const type = normalizeBlockType(blockType, data.triggerMode)

  const Icon = resolveIcon(type) ?? EMPTY_ICON
  const delay = animate ? index * BLOCK_STAGGER : 0

  const hasBranches = Boolean(branches && branches.length > 0)
  const hasTools = Boolean(tools && tools.length > 0)

  /** The View renders the default target/source/error handles (and the error row) for non-trigger blocks; mirror that gate. */
  const shouldShowDefaultHandles = !hideTargetHandle
  const hasContentBelowHeader =
    Boolean(data.sentence) ||
    dataRows.length > 0 ||
    hasBranches ||
    hasTools ||
    shouldShowDefaultHandles

  /**
   * Strip the app's `condition-`/`router-` handle prefixes — the View
   * regenerates them, so passing them through would double-prefix the handle id.
   * Branch + router-context values render through the editor's `getDisplayValue`,
   * which shows `-` for a blank value (e.g. an `else` branch); mirror that.
   */
  const conditionRows =
    type === 'condition'
      ? (branches ?? []).map((branch) => ({
          id: branch.id.replace(/^condition-/, ''),
          title: branch.label,
          value: branch.value || '-',
        }))
      : []
  const routerRows =
    type === 'router_v2'
      ? (branches ?? []).map((branch) => ({
          id: branch.id.replace(/^router-/, ''),
          value: branch.value || '-',
        }))
      : []
  /** The View renders the router's leading Context row from this prop, not `rows`. */
  const routerContextValue =
    type === 'router_v2' ? dataRows.find((row) => row.title === 'Context')?.value || '-' : undefined

  /**
   * Non-branch content only — the View renders condition/router/error rows from
   * the conditionRows/routerRows it receives, so their order stays locked to its
   * handle geometry in one place.
   */
  const rows =
    type === 'condition' || type === 'router_v2' ? null : (
      <>
        {dataRows.map((row) => (
          <SubBlockRowView key={row.title} title={row.title} displayValue={row.value} />
        ))}
        {hasTools && (
          <SubBlockRowView
            title='Tools'
            displayValue={tools?.map((tool) => tool.name).join(', ')}
          />
        )}
      </>
    )

  return (
    <m.div
      className={cn('relative transition-opacity duration-300', isDimmed && DIMMED_PREVIEW_CLASS)}
      initial={animate ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.45, delay, ease: EASE_OUT }}
    >
      <WorkflowBlockView
        id={id}
        type={type}
        name={name}
        isEnabled
        isLocked={false}
        hasRing={Boolean(isHighlighted)}
        ringStyles={RING_STYLES}
        Icon={Icon}
        iconBgColor={bgColor}
        typeLabel={data.typeLabel}
        isIntegration={data.isIntegration}
        horizontalHandles
        shouldShowDefaultHandles={shouldShowDefaultHandles}
        hasContentBelowHeader={hasContentBelowHeader}
        conditionRows={conditionRows}
        routerRows={routerRows}
        routerContextValue={routerContextValue}
        wouldCreateConnectionCycle={() => false}
        cursorConnectionsEnabled={false}
        hasErrorConnection={data.hasErrorConnection}
        errorOutputEnabled={data.hasErrorConnection}
        onSelect={selectBlock ? () => selectBlock(id) : undefined}
        sentence={
          data.sentence && (
            <CanvasSentenceView
              segments={data.sentence}
              renderChip={(title) => {
                const value =
                  dataRows.find((row) => row.title === title)?.value ??
                  (title === 'Tools' ? tools?.map((tool) => tool.name).join(', ') : undefined)
                if (!value || value === '-') return null
                return <SubBlockRowView title={title} displayValue={value} variant='inline-value' />
              }}
            />
          )
        }
        rows={rows}
      />
    </m.div>
  )
})
