'use client'

import { useState } from 'react'
import { Breadcrumbs } from '@sim/emcn/breadcrumbs'
import { Button } from '@sim/emcn/button'
import { InlineNotice } from '@sim/emcn/status'
import Link from 'next/link'
import { notFound, usePathname, useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { DirectoryHeading } from '@/app/(product)/_components/resource-directory/resource-directory'
import { DetailSplit } from '@/app/(product)/_components/workspace/detail-split/detail-split'
import { WorkflowPreview } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-preview/workflow-preview'
import { useWorkspaceTabFlags } from '@/app/(product)/_components/workspace/workspace-session/workspace-session'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/run-snapshot/run-snapshot.module.css'
import { SnapshotBlock } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/snapshot-block/snapshot-block'
import { useRunSnapshot } from '@/platform/lib/data/logs'
import { isWorkspaceTabShown } from '@/platform/lib/workspace-navigation'
import { runSnapshotParams, serializeRunSnapshot } from '@/platform/lib/workspace-views'

/** The block types that run another workflow, whose child run legacy's snapshot opens. */
const WORKFLOW_BLOCK_TYPES = new Set(['workflow', 'workflow_input'])

type RunSnapshotData = ReturnType<typeof useRunSnapshot>

/** One opened workflow: the run's own, or a child a workflow block on the level above ran. */
interface SnapshotLevel {
  id: string
  name: string
  workflowState: NonNullable<RunSnapshotData['workflowState']>
  blocks: RunSnapshotData['blocks']
}

interface RunSnapshotProps {
  workspaceId: string
  executionId: string
  back: { href: string; label: string }
  /** Where a run a test opened returns instead, while the Tests tab is shown. */
  testBack?: { href: string; label: string }
}

/**
 * The workflow exactly as a run executed it, as legacy's View Snapshot shows it: the blocks that ran
 * are marked with their outcome, and choosing any block opens its step and the fields it ran with
 * beside the canvas. A workflow block
 * opens the child workflow it ran, frozen as this run ran it, with a trail back to its parents; the
 * drill path lives in the URL.
 */
export function RunSnapshot({ workspaceId, executionId, back, testBack }: RunSnapshotProps) {
  const testsShown = isWorkspaceTabShown('tests', useWorkspaceTabFlags())
  const snapshot = useRunSnapshot(workspaceId, executionId)
  const pathname = usePathname()
  const search = useSearchParams()
  const [{ child: path }] = useQueryStates(runSnapshotParams)
  const [selection, setSelection] = useState<{ level: string; blockId: string } | null>(null)
  if (snapshot.missing) notFound()
  const shortId = executionId.slice(0, 8)
  // The opened levels, outermost first. A path from an old link stops at the first block it no longer finds.
  const levels: SnapshotLevel[] = []
  if (snapshot.workflowState) {
    levels.push({
      id: 'run',
      name: snapshot.run?.workflow.name ?? 'Workflow',
      workflowState: snapshot.workflowState,
      blocks: snapshot.blocks,
    })
    for (const blockId of path) {
      const child = levels[levels.length - 1].blocks.get(blockId)?.child
      if (!child) break
      levels.push({ id: blockId, ...child })
    }
  }
  const level = levels.at(-1)
  const depth = levels.length - 1
  const levelKey = levels.map((entry) => entry.id).join('/')
  const openedIds = levels.slice(1).map((entry) => entry.id)
  const pathHref = (blockIds: readonly string[]) =>
    serializeRunSnapshot(`${pathname}?${search.toString()}`, { child: [...blockIds] })
  const chosen = selection?.level === levelKey ? selection.blockId : null
  const blockId = chosen ?? level?.blocks.keys().next().value ?? null
  const selected = blockId === null ? undefined : level?.blocks.get(blockId)
  const childHref =
    blockId !== null &&
    selected?.child &&
    WORKFLOW_BLOCK_TYPES.has(level?.workflowState.blocks[blockId]?.type ?? '')
      ? pathHref([...openedIds, blockId])
      : undefined
  return (
    <DetailSplit
      read={snapshot.read}
      back={testBack && testsShown ? testBack : back}
      actions={
        childHref && (
          <Button variant='secondary' size='compact' render={<Link href={childHref} />}>
            Open child workflow
          </Button>
        )
      }
      label={`Run ${shortId} snapshot`}
      railKind='inspector'
      railLabel='Selected block'
      rail={
        level &&
        blockId !== null &&
        level.workflowState.blocks[blockId] && (
          <SnapshotBlock
            key={`${levelKey}/${blockId}`}
            workspaceId={workspaceId}
            workflowState={level.workflowState}
            blockId={blockId}
            run={{
              step: selected?.step,
              outputs: level.blocks,
              child:
                selected?.child && childHref
                  ? { workflowState: selected.child.workflowState, href: childHref }
                  : undefined,
            }}
          />
        )
      }
    >
      <DirectoryHeading
        title={`Run ${shortId} snapshot`}
        description={snapshot.run?.workflow.name}
      />
      {depth > 0 && (
        <Breadcrumbs
          label='Workflow'
          items={levels.map((entry, index) => ({
            id: `${index}/${entry.id}`,
            label: entry.name,
            href: index < depth ? pathHref(openedIds.slice(0, index)) : undefined,
          }))}
        />
      )}
      {snapshot.migrated ? (
        <InlineNotice
          intent='warning'
          title='Logged state not found'
          message='This log was migrated from the old logging system. The workflow state at the time of this run is not available.'
        />
      ) : (
        level && (
          <div className={styles.canvas}>
            <WorkflowPreview
              key={`${executionId}/${levelKey}`}
              workflowState={level.workflowState}
              workspaceId={workspaceId}
              isPannable
              defaultZoom={0.8}
              cursorStyle='pointer'
              executedBlocks={Object.fromEntries(level.blocks)}
              selectedBlockId={blockId}
              onNodeClick={(id) => setSelection({ level: levelKey, blockId: id })}
              height='100%'
              width='100%'
            />
          </div>
        )
      )}
    </DetailSplit>
  )
}
