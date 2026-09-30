'use client'

import { Search } from '@sim/emcn/icons'
import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import {
  breadcrumbFolderChain,
  folderBreadcrumbItems,
} from '@/app/workspace/[workspaceId]/components/folders'
import { ResourceHeader } from '@/app/workspace/[workspaceId]/components/resource/components/resource-header'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { useInvokeGlobalCommand } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useFolderMap } from '@/hooks/queries/folders'
import { getWorkflowListQueryOptions } from '@/hooks/queries/utils/workflow-list-query'

/** Keeps the open workflow identifiable when Build uses section-level navigation. */
export function WorkflowLocationBar() {
  const enabled = useFeatureFlag('org-project-view')
  return enabled ? <WorkflowLocationBarContent /> : null
}

function WorkflowLocationBarContent() {
  const { workspaceId, workflowId } = useParams<{ workspaceId: string; workflowId: string }>()
  const router = useRouter()
  /** The list's query options, not the workflows hooks: that module carries the trigger registry. */
  const { data: workflow } = useQuery({
    ...getWorkflowListQueryOptions(workspaceId),
    select: (list) => list.find((candidate) => candidate.id === workflowId),
  })
  const { data: folders } = useFolderMap(workspaceId)
  /** The search modal's command, not its store: the store carries the block registry. */
  const invokeCommand = useInvokeGlobalCommand()
  const openSearch = () => {
    invokeCommand('open-search')
  }
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
