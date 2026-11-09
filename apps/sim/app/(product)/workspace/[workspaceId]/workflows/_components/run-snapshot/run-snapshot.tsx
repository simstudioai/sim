'use client'

import { useState } from 'react'
import { InlineNotice } from '@sim/emcn/status'
import { notFound } from 'next/navigation'
import { DirectoryHeading } from '@/app/(product)/_components/resource-directory/resource-directory'
import { DetailSplit } from '@/app/(product)/workspace/[workspaceId]/_components/detail-split/detail-split'
import { SpanInspector } from '@/app/(product)/workspace/[workspaceId]/_components/span-inspector/span-inspector'
import { WorkflowPreview } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/workflow-preview/workflow-preview'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/run-snapshot/run-snapshot.module.css'
import { useRunSnapshot } from '@/platform/lib/data/logs'

interface RunSnapshotProps {
  workspaceId: string
  executionId: string
  back: { href: string; label: string }
}

/**
 * The workflow exactly as a run executed it, as legacy's View Snapshot shows it: the blocks that ran
 * are marked with their outcome, and choosing one opens its step beside the canvas.
 */
export function RunSnapshot({ workspaceId, executionId, back }: RunSnapshotProps) {
  const snapshot = useRunSnapshot(workspaceId, executionId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  if (snapshot.missing) notFound()
  const { blocks } = snapshot
  const blockId = selectedId ?? blocks.keys().next().value ?? null
  const selected = blockId === null ? undefined : blocks.get(blockId)
  const shortId = executionId.slice(0, 8)
  return (
    <DetailSplit
      read={snapshot.read}
      back={back}
      label={`Run ${shortId} snapshot`}
      railKind='inspector'
      railLabel='Selected block'
      rail={selected && <SpanInspector key={blockId} span={selected.step} />}
    >
      <DirectoryHeading
        title={`Run ${shortId} snapshot`}
        description={snapshot.run?.workflow.name}
      />
      {snapshot.migrated ? (
        <InlineNotice
          intent='warning'
          title='Logged state not found'
          message='This log was migrated from the old logging system. The workflow state at the time of this run is not available.'
        />
      ) : (
        snapshot.workflowState && (
          <div className={styles.canvas}>
            <WorkflowPreview
              key={executionId}
              workflowState={snapshot.workflowState}
              workspaceId={workspaceId}
              isPannable
              defaultZoom={0.8}
              cursorStyle='pointer'
              executedBlocks={Object.fromEntries(blocks)}
              selectedBlockId={blockId}
              onNodeClick={setSelectedId}
              height='100%'
              width='100%'
            />
          </div>
        )
      )}
    </DetailSplit>
  )
}
