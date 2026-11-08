'use client'

import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { InlineNotice } from '@sim/emcn/status'
import { getPreviewBlockDimensions } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-preview/preview-dimensions'
import { WorkflowPreview } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-preview/workflow-preview'
import { ChangeList } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/compare-versions/change-list'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/compare-versions/compare-versions.module.css'
import {
  buildWorkflowDiffOverlay,
  type ComparePair,
  type DeploymentVersion,
  formatVersionLabel,
  generateWorkflowDiffSummary,
  omitPresentationChanges,
  useDeploymentVersionState,
  useDraftWorkflowState,
  type WorkflowDiffSummary,
} from '@/platform/lib/data/workflow-deploy'
import type { WorkflowState } from '@/platform/lib/data/workflows'

type CompareSide = ComparePair['base']

const DRAFT = 'draft'

function sideToValue(side: CompareSide): string {
  return side.kind === 'draft' ? DRAFT : String(side.version)
}

function valueToSide(value: string): CompareSide {
  return value === DRAFT ? { kind: 'draft' } : { kind: 'version', version: Number(value) }
}

interface CompareVersionsProps {
  workflowId: string
  versions: readonly DeploymentVersion[]
  initial: ComparePair
  onClose: () => void
}

/**
 * Any two versions of the workflow side by side, the draft included: the later side's canvas with
 * every touched block marked and removed ones ghosted, beside the list of what changed. Both sides
 * are chosen in the toolbar, so a reviewer moves between pairs without leaving.
 */
export function CompareVersions({ workflowId, versions, initial, onClose }: CompareVersionsProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [base, setBase] = useState<CompareSide>(initial.base)
  const [target, setTarget] = useState<CompareSide>(initial.target)
  // Subscribed only while a side is the draft.
  const draftState = useDraftWorkflowState(
    workflowId,
    base.kind === 'draft' || target.kind === 'draft'
  )
  const baseQuery = useDeploymentVersionState(
    workflowId,
    base.kind === 'version' ? base.version : null
  )
  const targetQuery = useDeploymentVersionState(
    workflowId,
    target.kind === 'version' ? target.version : null
  )
  const baseState = base.kind === 'draft' ? draftState : (baseQuery.data ?? null)
  const targetState = target.kind === 'draft' ? draftState : (targetQuery.data ?? null)
  const loadError = baseQuery.error ?? targetQuery.error

  useLayoutEffect(() => {
    const element = dialog.current
    if (!element) return
    element.showModal()
    return () => element.close()
  }, [])

  const options = useMemo(
    () => [
      { value: DRAFT, label: 'Draft' },
      ...[...versions]
        .sort((left, right) => right.version - left.version)
        .map((version) => {
          // A name that only repeats the number would read as "v2 · v2".
          const name = version.name === `v${version.version}` ? null : version.name
          const label = formatVersionLabel(version.version, name)
          return {
            value: String(version.version),
            label: version.isActive ? `${label} (live)` : label,
          }
        }),
    ],
    [versions]
  )

  const summary = useMemo(
    () =>
      baseState && targetState
        ? omitPresentationChanges(generateWorkflowDiffSummary(targetState, baseState))
        : null,
    [baseState, targetState]
  )

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      data-material='floating'
      data-elevation='modal'
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={styles.layout}>
        <header className={styles.header}>
          <h2 id={titleId} data-type='T083'>
            Compare versions
          </h2>
          <IconButton label='Close' icon='I105' onClick={onClose} />
        </header>
        <div className={styles.toolbar}>
          <ChoiceMenu
            label='Compare from'
            options={options}
            value={sideToValue(base)}
            onValueChange={(value) => setBase(valueToSide(value))}
          />
          <span className={styles.arrow}>
            <Icon name='arrow-right' />
          </span>
          <ChoiceMenu
            label='Compare to'
            options={options}
            value={sideToValue(target)}
            onValueChange={(value) => setTarget(valueToSide(value))}
          />
          {summary && <DiffCounts summary={summary} />}
        </div>
        <div className={styles.body}>
          {loadError ? (
            <div className={styles.failure}>
              <InlineNotice
                intent='danger'
                message={loadError.message || 'Could not load one of the versions.'}
              />
            </div>
          ) : (
            summary &&
            baseState &&
            targetState && (
              <DiffView
                key={`${sideToValue(base)}:${sideToValue(target)}`}
                summary={summary}
                baseState={baseState}
                targetState={targetState}
              />
            )
          )}
        </div>
      </div>
    </dialog>
  )
}

/** How much changed, by kind; nothing at all reads "No changes". */
function DiffCounts({ summary }: { summary: WorkflowDiffSummary }) {
  // A reconfigured container counts as modified even when no field of its own changed.
  const modified = new Set([
    ...summary.modifiedBlocks.map((block) => block.id),
    ...summary.containerChanges.map((container) => container.id),
  ]).size
  const variables =
    summary.variableChanges.added +
    summary.variableChanges.removed +
    summary.variableChanges.modified
  const connections = summary.edgeChanges.added + summary.edgeChanges.removed
  const counts = [
    { id: 'added', label: 'added', value: summary.addedBlocks.length, kind: 'added' },
    { id: 'modified', label: 'modified', value: modified, kind: 'changed' },
    { id: 'removed', label: 'removed', value: summary.removedBlocks.length, kind: 'removed' },
    {
      id: 'connections',
      label: connections === 1 ? 'connection' : 'connections',
      value: connections,
      kind: undefined,
    },
    {
      id: 'variables',
      label: variables === 1 ? 'variable' : 'variables',
      value: variables,
      kind: undefined,
    },
  ].filter((count) => count.value > 0)
  return (
    <span className={styles.counts} data-type='T052'>
      {summary.hasChanges ? (
        counts.map((count) => (
          <span key={count.id} data-kind={count.kind}>
            {count.value} {count.label}
          </span>
        ))
      ) : (
        <span>No changes</span>
      )}
    </span>
  )
}

interface DiffViewProps {
  summary: WorkflowDiffSummary
  baseState: WorkflowState
  targetState: WorkflowState
}

/** The target canvas with the comparison painted on it, beside the change list; one selection. */
function DiffView({ summary, baseState, targetState }: DiffViewProps) {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const listEdges = useScrollEdges<HTMLDivElement>()
  const overlay = useMemo(
    () => buildWorkflowDiffOverlay(summary, baseState, targetState, getPreviewBlockDimensions),
    [summary, baseState, targetState]
  )
  const containers = useMemo(
    () => ({ base: baseState, target: targetState }),
    [baseState, targetState]
  )
  const clearSelection = useCallback(() => setSelectedBlockId(null), [])
  return (
    <div className={styles.split}>
      <div className={styles.canvas}>
        <WorkflowPreview
          workflowState={overlay.mergedState}
          blockDiffStatus={overlay.blockStatus}
          edgeDiffStatus={overlay.edgeStatus}
          changedFieldsByBlock={overlay.changedFieldsByBlock}
          removedPortsByBlock={overlay.removedPortsByBlock}
          selectedBlockId={selectedBlockId}
          onNodeClick={(blockId) =>
            setSelectedBlockId((current) => (current === blockId ? null : blockId))
          }
          onPaneClick={clearSelection}
          isPannable
          cursorStyle='pointer'
          defaultZoom={0.8}
          height='100%'
          width='100%'
        />
      </div>
      <div ref={listEdges} className={styles.list}>
        <ChangeList
          summary={summary}
          baseBlocks={baseState.blocks}
          targetBlocks={targetState.blocks}
          containers={containers}
          selectedBlockId={selectedBlockId}
          onSelectBlock={setSelectedBlockId}
        />
      </div>
    </div>
  )
}
