'use client'

import { TabStrip } from '@sim/emcn'
import { useParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import {
  FileNavigationProvider,
  useFileNavigation,
} from '@/app/workspace/[workspaceId]/files/components/file-detail'
import { Files } from '@/app/workspace/[workspaceId]/files/files'
import FilesLoading from '@/app/workspace/[workspaceId]/files/loading'
import { ProjectFiles } from '@/app/workspace/[workspaceId]/files/project-files'
import {
  fileOwnerParsers,
  filesFilterParsers,
  filesFilterUrlKeys,
  filesParsers,
  projectFilesScopeParsers,
} from '@/app/workspace/[workspaceId]/files/search-params'
import { useWorkspaceProject } from '@/hooks/queries/project-files'

interface FilesBrowserProps {
  projectFilesEnabled: boolean
}

export function FilesBrowser({ projectFilesEnabled }: FilesBrowserProps) {
  const { workspaceId, fileId } = useParams<{ workspaceId: string; fileId?: string }>()
  const [{ owner, projectId }] = useQueryStates(fileOwnerParsers)
  const parent = useWorkspaceProject(workspaceId, projectFilesEnabled)
  const project = parent.data?.project

  if (owner === 'project' && (!projectFilesEnabled || parent.error)) {
    return (
      <div role='status' className='p-6 text-small'>
        Project files are unavailable.
      </div>
    )
  }
  if (owner === 'project' && !project) return <FilesLoading />
  if (owner === 'project' && projectId && projectId !== project?.id) {
    return (
      <div role='status' className='p-6 text-small'>
        This Project does not contain this environment.
      </div>
    )
  }

  const fileOwner: EditableFileOwner =
    owner === 'project' && project
      ? { entityType: 'project', entityId: project.id }
      : { entityType: 'workspace', entityId: workspaceId }

  return (
    <FileNavigationProvider
      key={`${fileOwner.entityType}:${fileOwner.entityId}:${fileId ?? 'list'}`}
      owner={fileOwner}
      fileId={fileId ?? null}
    >
      <div className='flex h-full min-h-0 flex-col'>
        {project && projectFilesEnabled && (
          <FileOwnerTabs owner={fileOwner} projectId={project.id} workspaceId={workspaceId} />
        )}
        <div className='min-h-0 flex-1'>
          {owner === 'project' && project ? (
            <ProjectFiles project={project} workspaceId={workspaceId} />
          ) : (
            <Files />
          )}
        </div>
      </div>
    </FileNavigationProvider>
  )
}

interface FileOwnerTabsProps {
  owner: EditableFileOwner
  projectId: string
  workspaceId: string
}

function FileOwnerTabs({ owner, projectId, workspaceId }: FileOwnerTabsProps) {
  const { navigate } = useFileNavigation(owner)
  const { fileId } = useParams<{ fileId?: string }>()
  const [, setLocation] = useQueryStates({
    ...fileOwnerParsers,
    ...filesParsers,
    ...projectFilesScopeParsers,
  })
  const [, setFilters] = useQueryStates(filesFilterParsers, filesFilterUrlKeys)
  return (
    <TabStrip
      variant='underline'
      tabs={[
        { id: 'project', title: 'Project', active: owner.entityType === 'project' },
        { id: 'workspace', title: 'Environment', active: owner.entityType === 'workspace' },
      ]}
      onSelect={(next) => {
        if (next === owner.entityType || (next !== 'project' && next !== 'workspace')) return
        if (fileId) {
          navigate(
            next === 'project'
              ? `/workspace/${encodeURIComponent(workspaceId)}/files?owner=project&projectId=${encodeURIComponent(projectId)}`
              : `/workspace/${encodeURIComponent(workspaceId)}/files`
          )
          return
        }
        void setFilters({ uploadedBy: null })
        void setLocation(
          {
            owner: next,
            projectId: next === 'project' ? projectId : null,
            folderId: null,
            shareFileId: null,
            historyFileId: null,
            new: null,
            scope: null,
          },
          { history: 'push' }
        )
      }}
    />
  )
}
