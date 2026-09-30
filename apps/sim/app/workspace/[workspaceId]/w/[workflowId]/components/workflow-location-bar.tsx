'use client'

import { Search } from '@sim/emcn/icons'
import { useParams, useRouter } from 'next/navigation'
import {
  breadcrumbFolderChain,
  folderBreadcrumbItems,
} from '@/app/workspace/[workspaceId]/components/folders'
import { ResourceHeader } from '@/app/workspace/[workspaceId]/components/resource/components/resource-header'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { useFolderMap } from '@/hooks/queries/folders'
import { useWorkflowMap } from '@/hooks/queries/workflows'
import { useSearchModalStore } from '@/stores/modals/search/store'

/** Keeps the open workflow identifiable when Build uses section-level navigation. */
export function WorkflowLocationBar() {
  const enabled = useFeatureFlag('org-project-view')
  return enabled ? <WorkflowLocationBarContent /> : null
}

function WorkflowLocationBarContent() {
  const { workspaceId, workflowId } = useParams<{ workspaceId: string; workflowId: string }>()
  const router = useRouter()
  const { data: workflows } = useWorkflowMap(workspaceId)
  const { data: folders } = useFolderMap(workspaceId)
  const openSearch = useSearchModalStore((state) => state.open)
  const workflow = workflows?.[workflowId]
  const ancestors = breadcrumbFolderChain(
    workflow?.folderId,
    new Map(Object.values(folders ?? {}).map((folder) => [folder.id, folder]))
  )
  const breadcrumbs = folderBreadcrumbItems({
    rootLabel: 'Workflows',
    breadcrumbs: ancestors,
    onNavigate: (folderId) => {
      const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''
      router.push(`/workspace/${workspaceId}/w${query}`)
    },
    trailing: [{ label: workflow?.name ?? 'Workflow', onClick: openSearch }],
  })

  return (
    <div className='shrink-0'>
      <ResourceHeader
        breadcrumbs={breadcrumbs}
        actions={[
          {
            id: 'search-resources',
            text: 'Search resources',
            icon: Search,
            onSelect: openSearch,
          },
        ]}
      />
    </div>
  )
}
