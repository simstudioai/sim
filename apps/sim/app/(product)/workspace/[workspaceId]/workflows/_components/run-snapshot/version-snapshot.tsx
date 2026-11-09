'use client'

import { DirectoryHeading } from '@/app/(product)/_components/resource-directory/resource-directory'
import { DetailSplit } from '@/app/(product)/workspace/[workspaceId]/_components/detail-split/detail-split'
import type { WorkspaceRead } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/model'
import { WorkflowPreview } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/workflow-preview/workflow-preview'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/run-snapshot/run-snapshot.module.css'
import { useDeploymentVersionState } from '@/platform/lib/data/workflow-deploy'
import { useWorkflowMap } from '@/platform/lib/data/workflows'

interface VersionSnapshotProps {
  workspaceId: string
  workflowId: string
  version: number
  back: { href: string; label: string }
}

/**
 * One deployed version of a workflow on a read-only canvas, as legacy's version preview shows it:
 * the version a test ran against, however the workflow has changed since.
 */
export function VersionSnapshot({ workspaceId, workflowId, version, back }: VersionSnapshotProps) {
  const state = useDeploymentVersionState(workflowId, version)
  const workflows = useWorkflowMap(workspaceId)
  const title = `Version ${version}`
  const read: WorkspaceRead = state.isError
    ? {
        status: 'error',
        message: state.error.message,
        retrying: state.isFetching,
        onRetry: () => void state.refetch(),
      }
    : state.data
      ? { status: 'ready' }
      : { status: 'pending' }
  return (
    <DetailSplit read={read} back={back} label={title} railLabel='Version facts'>
      <DirectoryHeading title={title} description={workflows.data?.[workflowId]?.name} />
      {state.data && (
        <div className={styles.canvas}>
          <WorkflowPreview
            key={`${workflowId}:${version}`}
            workflowState={state.data}
            workspaceId={workspaceId}
            isPannable
            defaultZoom={0.8}
            cursorStyle='grab'
            height='100%'
            width='100%'
          />
        </div>
      )}
    </DetailSplit>
  )
}
