'use client'

import { type ComponentType, memo } from 'react'
import { SubBlockRowView, WorkflowBlockView } from '@sim/workflow-renderer'
import { m } from 'framer-motion'
import type { NodeProps } from 'reactflow'
import { resolveIcon } from '@/components/workflow-preview/block-icons'
import {
  BLOCK_STAGGER,
  EASE_OUT,
  type PreviewTool,
} from '@/components/workflow-preview/workflow-data'

/** Renders the colored square with no glyph when a block type has no registered icon. */
const EMPTY_ICON: ComponentType<{ className?: string }> = () => null

const RING_STYLES = 'ring-2 ring-[var(--brand-secondary)]'

interface DocsBlockData {
  name: string
  blockType: string
  bgColor: string
  rows: Array<{ title: string; value: string }>
  branches?: Array<{ id: string; label: string; value?: string }>
  tools?: PreviewTool[]
  hideTargetHandle?: boolean
  index?: number
  animate?: boolean
  isHighlighted?: boolean
  isDimmed?: boolean
}

/**
 * Docs adapter for workflow block nodes: maps the static preview data to the
 * shared {@link WorkflowBlockView}'s props. Carries no stores, hooks, or
 * queries — it only reshapes data into View props and wraps the result in the
 * dim/stagger motion used by the rest of the diagram (the parent
 * `WorkflowPreview` provides the `LazyMotion` feature set). The block's ring is
 * driven by `hasRing`/`ringStyles` inside the View.
 */
export const DocsBlockNode = memo(function DocsBlockNode({ id, data }: NodeProps<DocsBlockData>) {
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
  const type = blockType === 'router' ? 'router_v2' : blockType

  const Icon = resolveIcon(blockType) ?? EMPTY_ICON
  const delay = animate ? index * BLOCK_STAGGER : 0

  const hasBranches = Boolean(branches && branches.length > 0)
  const hasTools = Boolean(tools && tools.length > 0)

  /** The View renders the default target/source/error handles (and the error row) for non-trigger blocks; mirror that gate. */
  const shouldShowDefaultHandles = !hideTargetHandle
  const hasContentBelowHeader =
    dataRows.length > 0 || hasBranches || hasTools || shouldShowDefaultHandles

  /**
   * Strip the app's `condition-`/`router-` handle prefixes — the View
   * regenerates them, so passing them through would double-prefix the handle id.
   */
  const conditionRows =
    type === 'condition'
      ? (branches ?? []).map((branch) => ({
          id: branch.id.replace(/^condition-/, ''),
          title: branch.label,
          value: branch.value ?? '',
        }))
      : []
  const routerRows =
    type === 'router_v2'
      ? (branches ?? []).map((branch) => ({
          id: branch.id.replace(/^router-/, ''),
          value: branch.value ?? '',
        }))
      : []

  /**
   * Replicate the editor's row order so the View's absolute condition/router
   * handle offsets line up: branch rows first (router adds a leading Context
   * row); other blocks render their subblock rows, a Tools row, then the error
   * row when default handles are shown.
   */
  const rows =
    type === 'condition' ? (
      (branches ?? []).map((branch) => (
        <SubBlockRowView key={branch.id} title={branch.label} displayValue={branch.value} />
      ))
    ) : type === 'router_v2' ? (
      <>
        <SubBlockRowView key='context' title='Context' displayValue='' />
        {(branches ?? []).map((branch, routeIndex) => (
          <SubBlockRowView
            key={branch.id}
            title={`Route ${routeIndex + 1}`}
            displayValue={branch.value}
          />
        ))}
      </>
    ) : (
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
        {shouldShowDefaultHandles && <SubBlockRowView title='error' />}
      </>
    )

  return (
    <m.div
      className='relative transition-opacity duration-300'
      style={{ opacity: isDimmed ? 0.35 : 1 }}
      initial={animate ? { opacity: 0 } : false}
      animate={{ opacity: isDimmed ? 0.35 : 1 }}
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
        horizontalHandles
        shouldShowDefaultHandles={shouldShowDefaultHandles}
        hasContentBelowHeader={hasContentBelowHeader}
        conditionRows={conditionRows}
        routerRows={routerRows}
        wouldCreateConnectionCycle={() => false}
        isWorkflowSelector={false}
        childWorkflowId={undefined}
        childIsDeployed={null}
        childNeedsRedeploy={false}
        isDeploying={false}
        canAdmin={false}
        onDeployChild={() => {}}
        shouldShowScheduleBadge={false}
        scheduleIsDisabled={false}
        onReactivateSchedule={() => {}}
        showWebhookIndicator={false}
        webhookProvider={undefined}
        webhookPath={undefined}
        webhookProviderName={undefined}
        isWebhookConfigured={false}
        isWebhookDisabled={false}
        webhookId={undefined}
        onReactivateWebhook={() => {}}
        onSelect={() => {}}
        rows={rows}
      />
    </m.div>
  )
})
