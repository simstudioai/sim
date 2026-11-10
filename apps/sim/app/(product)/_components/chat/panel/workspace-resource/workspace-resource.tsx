'use client'

import dynamic from 'next/dynamic'
import { TabUrlState } from '@/app/(product)/_components/chat/panel/workspace-resource/tab-url-state'
import styles from '@/app/(product)/_components/chat/panel/workspace-resource/workspace-resource.module.css'
import { AccessBoundary } from '@/app/(product)/_components/workspace/access-required/access-boundary'
import { EmbeddedWorkspacePages } from '@/app/(product)/_components/workspace/workspace-page/workspace-page'
import { WorkspaceSession } from '@/app/(product)/_components/workspace/workspace-session/workspace-session'
import type { PlatformResource } from '@/platform/lib/data/models/chat'

/** The workspace's realtime socket, only for the pages that show presence or edit together. */
const WorkspaceRealtime = dynamic(
  () => import('@/platform/lib/data/realtime').then((module) => module.WorkspaceRealtime),
  { ssr: false }
)

const FileView = dynamic(
  () =>
    import('@/app/(product)/_components/workspace/files/file-view/file-view').then(
      (module) => module.FileView
    ),
  { ssr: false }
)

const TableRoute = dynamic(
  () =>
    import('@/app/(product)/_components/workspace/tables/table-route/table-route').then(
      (module) => module.TableRoute
    ),
  { ssr: false }
)

const KnowledgeBase = dynamic(
  () =>
    import('@/app/(product)/_components/workspace/knowledge/knowledge-base/knowledge-base').then(
      (module) => module.KnowledgeBase
    ),
  { ssr: false }
)

const LiveDashboard = dynamic(
  () =>
    import('@/app/(product)/_components/workspace/dashboards/live-dashboard/live-dashboard').then(
      (module) => module.LiveDashboard
    ),
  { ssr: false }
)

const WorkflowResource = dynamic(
  () =>
    import('@/app/(product)/_components/chat/panel/workspace-resource/workflow-resource').then(
      (module) => module.WorkflowResource
    ),
  { ssr: false }
)

const LogResource = dynamic(
  () =>
    import('@/app/(product)/_components/chat/panel/workspace-resource/log-resource').then(
      (module) => module.LogResource
    ),
  { ssr: false }
)

const FolderResource = dynamic(
  () =>
    import('@/app/(product)/_components/chat/panel/workspace-resource/folder-resource').then(
      (module) => module.FolderResource
    ),
  { ssr: false }
)

interface WorkspaceResourceProps {
  resource: PlatformResource
  workspaceId: string
}

function ResourceView({ resource, workspaceId }: WorkspaceResourceProps) {
  switch (resource.type) {
    case 'file':
      return (
        <AccessBoundary workspaceId={workspaceId} gate='hideFilesTab' current='files' layout='fill'>
          <WorkspaceRealtime>
            <FileView
              key={resource.id}
              workspaceId={workspaceId}
              fileId={resource.id}
              stream={resource.stream}
            />
          </WorkspaceRealtime>
        </AccessBoundary>
      )
    case 'table':
      return (
        <AccessBoundary
          workspaceId={workspaceId}
          gate='hideTablesTab'
          current='tables'
          layout='canvas'
        >
          <WorkspaceRealtime>
            <TableRoute key={resource.id} workspaceId={workspaceId} tableId={resource.id} />
          </WorkspaceRealtime>
        </AccessBoundary>
      )
    case 'knowledgebase':
      return (
        <AccessBoundary
          workspaceId={workspaceId}
          gate='hideKnowledgeBaseTab'
          current='knowledge'
          layout='fill'
        >
          <KnowledgeBase
            key={resource.id}
            workspaceId={workspaceId}
            knowledgeBaseId={resource.id}
          />
        </AccessBoundary>
      )
    case 'dashboard':
      return <LiveDashboard workspaceId={workspaceId} />
    case 'workflow':
      return (
        <WorkflowResource key={resource.id} workspaceId={workspaceId} workflowId={resource.id} />
      )
    case 'log':
      return (
        <LogResource
          key={resource.id}
          workspaceId={workspaceId}
          logId={resource.id}
          executionId={resource.executionId}
        />
      )
    case 'folder':
      return <FolderResource key={resource.id} workspaceId={workspaceId} folderId={resource.id} />
    default:
      return null
  }
}

/**
 * A workspace resource inside a chat panel tab: the same view its workspace page shows, without the
 * workspace's heading and tabs, with URL state of its own. Loaded per tab, so a chat that never
 * opens one never downloads these views.
 */
export function WorkspaceResource({ resource, workspaceId }: WorkspaceResourceProps) {
  return (
    <div className={styles.resource}>
      <WorkspaceSession mode='live'>
        <TabUrlState>
          <EmbeddedWorkspacePages>
            <ResourceView resource={resource} workspaceId={workspaceId} />
          </EmbeddedWorkspacePages>
        </TabUrlState>
      </WorkspaceSession>
    </div>
  )
}
