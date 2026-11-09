'use client'

import { useMemo } from 'react'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { SettingsRow } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import { FieldStack, Muted } from '@/app/(product)/_components/settings-parts/settings-parts'
import {
  CheckboxTree,
  type CheckboxTreeNode,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/fork-checkbox-tree'
import {
  useFolders,
  useUpdateForkSyncDefault,
  useUpdateForkSyncedWorkflows,
  useWorkspaceWorkflowList,
  type WorkflowFolder,
  type WorkflowMetadata,
} from '@/platform/lib/data/forks'

/**
 * The sidebar's folder structure for the workspace's DEPLOYED workflows, the only ones that sync.
 * Branches with no deployed workflow beneath them are pruned; a workflow whose folder was deleted
 * falls to the root so it stays selectable. Folders sort as the sidebar does (order, then name);
 * workflows keep the list order.
 */
function buildSyncTree(
  workflows: readonly WorkflowMetadata[],
  folders: readonly WorkflowFolder[]
): CheckboxTreeNode[] {
  const folderById = new Map(folders.map((folder) => [folder.id, folder]))
  const childFolders = new Map<string | null, WorkflowFolder[]>()
  for (const folder of folders) {
    const parentId = folder.parentId && folderById.has(folder.parentId) ? folder.parentId : null
    childFolders.set(parentId, [...(childFolders.get(parentId) ?? []), folder])
  }
  const workflowsByFolder = new Map<string | null, CheckboxTreeNode[]>()
  for (const workflow of workflows) {
    if (!workflow.isDeployed || workflow.archivedAt) continue
    const folderId =
      workflow.folderId && folderById.has(workflow.folderId) ? workflow.folderId : null
    workflowsByFolder.set(folderId, [
      ...(workflowsByFolder.get(folderId) ?? []),
      { id: workflow.id, label: workflow.name },
    ])
  }
  const sortFolders = (list: readonly WorkflowFolder[]) =>
    [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  const buildFolder = (folder: WorkflowFolder): CheckboxTreeNode | null => {
    const children = [
      ...sortFolders(childFolders.get(folder.id) ?? [])
        .map(buildFolder)
        .filter((child): child is CheckboxTreeNode => child !== null),
      ...(workflowsByFolder.get(folder.id) ?? []),
    ]
    return children.length > 0 ? { id: folder.id, label: folder.name, children } : null
  }
  return [
    ...sortFolders(childFolders.get(null) ?? [])
      .map(buildFolder)
      .filter((folder): folder is CheckboxTreeNode => folder !== null),
    ...(workflowsByFolder.get(null) ?? []),
  ]
}

interface ForkSyncDefaultRowProps {
  workspaceId: string
  /** The lineage's stored policy: true means new workflows start outside fork sync. */
  excludeNewWorkflows: boolean
}

/**
 * Whether a new workflow in this lineage joins fork sync. The write reaches every workspace in the
 * lineage and only applies forward; no existing workflow moves.
 */
export function ForkSyncDefaultRow({ workspaceId, excludeNewWorkflows }: ForkSyncDefaultRowProps) {
  const updateDefault = useUpdateForkSyncDefault()
  return (
    <SettingsRow
      label='Sync new workflows by default'
      description='Applies to every workspace in this fork lineage.'
    >
      <SegmentedControl
        label='Sync new workflows by default'
        value={excludeNewWorkflows ? 'exclude' : 'sync'}
        options={[
          { value: 'sync', label: 'Sync', disabled: updateDefault.isPending },
          { value: 'exclude', label: "Don't sync", disabled: updateDefault.isPending },
        ]}
        onSelect={(value) =>
          updateDefault.mutate(
            { workspaceId, body: { excludeNewWorkflows: value === 'exclude' } },
            {
              onError: (error) =>
                toast.error(getErrorMessage(error, 'Failed to update the fork sync default')),
            }
          )
        }
      />
    </SettingsRow>
  )
}

/**
 * The deployed workflows in their folders, each checked while it SYNCS: it takes part in sync both
 * ways and is copied into new forks. Unchecking keeps it here only; it stays deployed, and a synced
 * counterpart elsewhere keeps its last deployed version. A folder toggles its whole subtree. The
 * stored flag is `forkSyncExcluded`, so this owns the one inversion.
 */
export function ForkSyncedWorkflows({ workspaceId }: { workspaceId: string }) {
  const workflowsQuery = useWorkspaceWorkflowList(workspaceId)
  const foldersQuery = useFolders(workspaceId)
  const updateSynced = useUpdateForkSyncedWorkflows()
  const workflows = workflowsQuery.data
  const folders = foldersQuery.data

  const syncedIds = useMemo(
    () => new Set((workflows ?? []).filter((w) => !w.forkSyncExcluded).map((w) => w.id)),
    [workflows]
  )
  const tree = useMemo(() => buildSyncTree(workflows ?? [], folders ?? []), [workflows, folders])

  const toggle = (workflowIds: string[], synced: boolean) => {
    const changed = workflowIds.filter((id) => syncedIds.has(id) !== synced)
    if (changed.length === 0) return
    updateSynced.mutate(
      { workspaceId, body: { workflowIds: changed, forkSyncExcluded: !synced } },
      {
        onError: (error) =>
          toast.error(getErrorMessage(error, 'Failed to update synced workflows')),
      }
    )
  }

  // Both lists keep the previous workspace's rows as placeholders; acting on them would write
  // another workspace's workflow ids here.
  if (
    workflowsQuery.isPending ||
    workflowsQuery.isPlaceholderData ||
    foldersQuery.isPending ||
    foldersQuery.isPlaceholderData
  )
    return null

  if (workflowsQuery.isError || foldersQuery.isError) {
    return (
      <FieldStack>
        <FailureNotice
          message={getErrorMessage(
            workflowsQuery.error ?? foldersQuery.error,
            'Failed to load workflows'
          )}
          retrying={workflowsQuery.isFetching || foldersQuery.isFetching}
          onRetry={() => {
            void workflowsQuery.refetch()
            void foldersQuery.refetch()
          }}
        />
      </FieldStack>
    )
  }

  return (
    <FieldStack>
      {tree.length === 0 ? (
        <Muted>No deployed workflows — only deployed workflows sync</Muted>
      ) : (
        <CheckboxTree
          nodes={tree}
          isSelected={(id) => syncedIds.has(id)}
          onToggle={toggle}
          groupActionLabel={(label) => `Sync all in ${label}`}
          initiallyExpanded
          disabled={updateSynced.isPending}
        />
      )}
    </FieldStack>
  )
}
