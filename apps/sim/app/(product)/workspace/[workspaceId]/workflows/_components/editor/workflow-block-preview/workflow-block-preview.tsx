'use client'

import { IconButton } from '@sim/emcn/button'
import { workspacePath } from '@/lib/navigation/paths'
import { WorkflowPreview } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/workflow-preview/workflow-preview'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/workflow-block-preview/workflow-block-preview.module.css'
import { useWorkflowState } from '@/platform/lib/data/workflow-editor'

/** The legacy editor's preview frame: 160px tall, zoomed out to fit the child's blocks. */
const PREVIEW_HEIGHT = 160

interface WorkflowBlockPreviewProps {
  workspaceId: string
  workflowId: string
}

/**
 * The child workflow a Workflow block runs, as a pannable read-only canvas, with a way to open it
 * in a new tab. The frame stays empty while the child loads.
 */
export function WorkflowBlockPreview({ workspaceId, workflowId }: WorkflowBlockPreviewProps) {
  const { data: workflowState, isLoading } = useWorkflowState(workflowId)

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
            <span className={styles.open}>
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
            </span>
          </>
        ) : (
          !isLoading && (
            <span className={styles.unavailable} data-type='T060'>
              Unable to load preview
            </span>
          )
        )}
      </div>
    </div>
  )
}
