'use client'

import { Loader } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { DashboardFeatureGate } from '@/components/dashboards/dashboard-feature-gate'
import { DashboardPreview } from '@/components/dashboards/dashboard-preview'
import {
  breadcrumbFolderChain,
  FOLDERED_RESOURCE_HEADERS,
  folderBreadcrumbItems,
  folderedResourceListHref,
} from '@/app/workspace/[workspaceId]/components/folders'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'
import { useWorkspaceFilesRoom } from '@/app/workspace/[workspaceId]/files/hooks/use-workspace-files-room'
import { useDashboard, useDashboardFolders } from '@/hooks/queries/dashboards'

interface DashboardResourceProps {
  workspaceId: string
  dashboardId: string
  embedded?: boolean
}

/** Embedded dashboards use the chat's resource bar; full pages use the shared folder trail. */
export function DashboardResource(props: DashboardResourceProps) {
  return (
    <DashboardFeatureGate>
      <EnabledDashboardResource {...props} />
    </DashboardFeatureGate>
  )
}

function EnabledDashboardResource({ workspaceId, dashboardId, embedded }: DashboardResourceProps) {
  useWorkspaceFilesRoom(workspaceId)
  const router = useRouter()
  const query = useDashboard(workspaceId, dashboardId)
  const folderQuery = useDashboardFolders(embedded ? '' : workspaceId)
  const ancestors = breadcrumbFolderChain(
    query.data?.dashboard.folderId,
    new Map(folderQuery.data?.folders.map((folder) => [folder.id, folder]))
  )
  const header = FOLDERED_RESOURCE_HEADERS.dashboard
  return (
    <Resource>
      {!embedded && (
        <Resource.Header
          icon={header.rootIcon}
          breadcrumbs={folderBreadcrumbItems({
            rootLabel: header.rootLabel,
            rootIcon: header.rootIcon,
            breadcrumbs: ancestors,
            onNavigate: (folderId) =>
              router.push(folderedResourceListHref('dashboard', workspaceId, folderId)),
            trailing: [
              query.data ? { label: query.data.dashboard.name } : { label: '…', terminal: true },
            ],
          })}
        />
      )}
      <div className='min-h-0 flex-1 overflow-auto p-6'>
        {query.isPending ? (
          <div role='status' className='flex h-full items-center justify-center'>
            <Loader animate className='size-[16px] text-[var(--text-icon)]' />
            <span className='sr-only'>Loading dashboard</span>
          </div>
        ) : query.error ? (
          <div className='text-[var(--text-error)]' role='alert'>
            {query.error.message}
          </div>
        ) : (
          <DashboardPreview
            workspaceId={workspaceId}
            fileId={dashboardId}
            content={query.data.content}
          />
        )}
      </div>
    </Resource>
  )
}
