'use client'

import { ActivityRow } from '@sim/emcn/activity-row'
import { EmptyState } from '@sim/emcn/empty-state'
import { ScrollArea } from '@sim/emcn/scroll-area'
import { compareStrings } from '@sim/utils/string'
import { workspacePath } from '@/lib/navigation/paths'
import styles from '@/app/(product)/_components/chat/panel/workspace-resource/workspace-resource.module.css'
import { useFolderMap } from '@/platform/lib/data/folders'
import { useWorkflowMap } from '@/platform/lib/data/workflow-editor'

interface FolderResourceProps {
  workspaceId: string
  folderId: string
}

/** A workflow folder: its workflows, each opening on its workflow page. */
export function FolderResource({ workspaceId, folderId }: FolderResourceProps) {
  const folders = useFolderMap(workspaceId)
  const workflows = useWorkflowMap(workspaceId)
  if (!folders.data || !workflows.data) return null
  const folder = folders.data[folderId]
  if (!folder)
    return (
      <EmptyState
        title='Folder not found'
        description='This folder may have been deleted or moved.'
      />
    )
  const inFolder = Object.values(workflows.data)
    .filter((workflow) => workflow.folderId === folderId)
    .sort((a, b) => compareStrings(a.name, b.name))
  if (!inFolder.length)
    return <EmptyState title={folder.name} description='No workflows in this folder.' />
  return (
    <ScrollArea label={`${folder.name} workflows`}>
      <ul className={styles.list} aria-label={`${folder.name} workflows`}>
        {inFolder.map((workflow) => (
          <ActivityRow
            key={workflow.id}
            title={workflow.name}
            href={workspacePath(workspaceId, `workflows/${encodeURIComponent(workflow.id)}`)}
          />
        ))}
      </ul>
    </ScrollArea>
  )
}
