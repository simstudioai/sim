'use client'

import type { ReactNode } from 'react'
import { IconButton } from '@sim/emcn/button'
import { FailureNotice } from '@sim/emcn/status'
import Link from 'next/link'
import { workspacePath } from '@/lib/navigation/paths'
import { WorkflowPreview } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-preview/workflow-preview'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/workflow-block-preview/workflow-block-preview.module.css'
import { useWorkflowState } from '@/platform/lib/data/workflow-editor'
import type { WorkflowState } from '@/platform/lib/data/workflows'

/** The legacy editor's preview frame: 160px tall, zoomed out to fit the child's blocks. */
const PREVIEW_HEIGHT = 160

interface PreviewFrameProps {
  workspaceId: string
  workflowState: WorkflowState | undefined
  /** What the frame says when it has no workflow to draw; absent leaves it empty. */
  unavailable?: string
  action: ReactNode
}

function PreviewFrame({ workspaceId, workflowState, unavailable, action }: PreviewFrameProps) {
  return (
    <div className={styles.preview}>
      <span className={styles.label} data-type='T059'>
        Workflow Preview
      </span>
      <div className={styles.frame}>
        {workflowState ? (
          <>
            <div className={styles.canvas}>
              <WorkflowPreview
                workflowState={workflowState}
                workspaceId={workspaceId}
                height={PREVIEW_HEIGHT}
                width='100%'
                isPannable
                defaultZoom={0.6}
                fitPadding={0.15}
                cursorStyle='grab'
                lightweight
              />
            </div>
            {action && <span className={styles.open}>{action}</span>}
          </>
        ) : (
          unavailable && (
            <span className={styles.unavailable} data-type='T060'>
              {unavailable}
            </span>
          )
        )}
      </div>
    </div>
  )
}

interface WorkflowBlockPreviewProps {
  workspaceId: string
  workflowId: string
}

/**
 * The child workflow a Workflow block runs, as a pannable read-only canvas, with a way to open it
 * in a new tab. The frame stays empty while the child loads.
 */
export function WorkflowBlockPreview({ workspaceId, workflowId }: WorkflowBlockPreviewProps) {
  const child = useWorkflowState(workflowId)
  if (child.isError)
    return (
      <FailureNotice
        message='Unable to load preview'
        retrying={child.isFetching}
        onRetry={() => void child.refetch()}
      />
    )
  return (
    <PreviewFrame
      workspaceId={workspaceId}
      workflowState={child.data}
      action={
        <IconButton
          label='Open workflow'
          icon='I037'
          size='compact'
          variant='floating'
          tooltip
          onClick={() =>
            window.open(
              `${workspacePath(workspaceId, 'workflows')}/${workflowId}`,
              '_blank',
              'noopener,noreferrer'
            )
          }
        />
      }
    />
  )
}

interface FrozenWorkflowBlockPreviewProps {
  workspaceId: string
  /** The child workflow as the run ran it; absent when the run never reached the block or kept no snapshot. */
  workflowState: WorkflowState | undefined
  /** Where the child's own snapshot opens in place of the run's. */
  expandHref: string | undefined
  unavailable: string
}

/**
 * A run snapshot's Workflow block: the child workflow frozen as this run ran it, as legacy's preview
 * editor showed it, expanding into the child's snapshot rather than the live workflow.
 */
export function FrozenWorkflowBlockPreview({
  workspaceId,
  workflowState,
  expandHref,
  unavailable,
}: FrozenWorkflowBlockPreviewProps) {
  return (
    <PreviewFrame
      workspaceId={workspaceId}
      workflowState={workflowState}
      unavailable={unavailable}
      action={
        expandHref && (
          <IconButton
            label='Expand workflow'
            icon='I060'
            size='compact'
            variant='floating'
            tooltip
            render={<Link href={expandHref} />}
          />
        )
      }
    />
  )
}
