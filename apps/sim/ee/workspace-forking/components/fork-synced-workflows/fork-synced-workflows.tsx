'use client'

import { useId, useMemo, useState } from 'react'
import { Checkbox, ChevronDown, cn, OverflowText, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { useUpdateForkSyncedWorkflows } from '@/ee/workspace-forking/hooks/workspace-fork'
import { useFolders } from '@/hooks/queries/folders'
import { useWorkflows } from '@/hooks/queries/workflows'
import type { WorkflowFolder } from '@/stores/folders/types'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

/** Indent per nesting level, matching the sidebar tree (`TREE_SPACING.INDENT_PER_LEVEL`). */
const INDENT_PER_LEVEL = 20

/** Guide-line offset within a level: the horizontal center of the `sm` checkbox. */
const GUIDE_OFFSET = 7

interface SyncWorkflowItem {
  id: string
  name: string
}

interface SyncTreeFolder {
  id: string
  name: string
  children: SyncTreeFolder[]
  workflows: SyncWorkflowItem[]
  /** Every deployed workflow id in this folder's subtree, for the folder-level select-all. */
  descendantWorkflowIds: string[]
}

/**
 * Mirror the sidebar's folder structure for the workspace's DEPLOYED workflows (the only
 * ones that sync). Branches with no deployed workflows anywhere beneath them are pruned;
 * a workflow whose folder was deleted falls into the root bucket so it stays selectable.
 * Folders sort like the sidebar (sortOrder, then name); workflows keep the list order.
 */
export function buildForkSyncWorkflowTree(
  workflows: WorkflowMetadata[],
  folders: WorkflowFolder[]
): { folders: SyncTreeFolder[]; rootWorkflows: SyncWorkflowItem[] } {
  const folderById = new Map(folders.map((folder) => [folder.id, folder]))
  const childFolders = new Map<string | null, WorkflowFolder[]>()
  for (const folder of folders) {
    const parentId = folder.parentId && folderById.has(folder.parentId) ? folder.parentId : null
    const siblings = childFolders.get(parentId)
    if (siblings) siblings.push(folder)
    else childFolders.set(parentId, [folder])
  }

  const workflowsByFolder = new Map<string | null, SyncWorkflowItem[]>()
  for (const workflow of workflows) {
    if (!workflow.isDeployed || workflow.archivedAt) continue
    const folderId =
      workflow.folderId && folderById.has(workflow.folderId) ? workflow.folderId : null
    const item: SyncWorkflowItem = { id: workflow.id, name: workflow.name }
    const bucket = workflowsByFolder.get(folderId)
    if (bucket) bucket.push(item)
    else workflowsByFolder.set(folderId, [item])
  }

  const sortFolders = (list: WorkflowFolder[]) =>
    [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))

  const buildFolder = (folder: WorkflowFolder): SyncTreeFolder | null => {
    const children = sortFolders(childFolders.get(folder.id) ?? [])
      .map(buildFolder)
      .filter((child): child is SyncTreeFolder => child !== null)
    const own = workflowsByFolder.get(folder.id) ?? []
    if (children.length === 0 && own.length === 0) return null
    return {
      id: folder.id,
      name: folder.name,
      children,
      workflows: own,
      descendantWorkflowIds: [
        ...own.map((workflow) => workflow.id),
        ...children.flatMap((child) => child.descendantWorkflowIds),
      ],
    }
  }

  return {
    folders: sortFolders(childFolders.get(null) ?? [])
      .map(buildFolder)
      .filter((folder): folder is SyncTreeFolder => folder !== null),
    rootWorkflows: workflowsByFolder.get(null) ?? [],
  }
}

interface ForkSyncedWorkflowsProps {
  workspaceId: string
}

/**
 * The Forks page's "Synced workflows" section body: the workspace's deployed workflows
 * in their sidebar folder structure, each with a checkbox. Checked = SYNCED - the
 * workflow participates in promote in both directions and is copied into new forks.
 * Unchecked leaves it in this workspace only; it stays deployed and serving, and a
 * previously-synced counterpart in another workspace keeps running on its last deployed
 * version rather than being archived. A folder's checkbox toggles its whole subtree at
 * once (tri-state while partially synced). Toggles apply immediately.
 *
 * The wire field stays `forkSyncExcluded` (matching the column), so this component owns
 * the single inversion between the stored flag and what the user reads.
 */
export function ForkSyncedWorkflows({ workspaceId }: ForkSyncedWorkflowsProps) {
  const workflowsQuery = useWorkflows(workspaceId)
  const foldersQuery = useFolders(workspaceId)
  const updateSynced = useUpdateForkSyncedWorkflows()

  const workflows = workflowsQuery.data
  const folders = foldersQuery.data

  const syncedIds = useMemo(
    () =>
      new Set((workflows ?? []).filter((workflow) => !workflow.forkSyncExcluded).map((w) => w.id)),
    [workflows]
  )
  const tree = useMemo(
    () => buildForkSyncWorkflowTree(workflows ?? [], folders ?? []),
    [workflows, folders]
  )

  const toggle = (workflowIds: string[], synced: boolean) => {
    // Send only real transitions so a folder select-all never writes no-op rows.
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

  if (workflowsQuery.isLoading || foldersQuery.isLoading) return null

  if (tree.folders.length === 0 && tree.rootWorkflows.length === 0) {
    return (
      <SettingsEmptyState variant='inline'>
        No deployed workflows — only deployed workflows sync
      </SettingsEmptyState>
    )
  }

  return (
    <div className='flex flex-col gap-0.5'>
      {tree.folders.map((folder) => (
        <SyncFolderRow
          key={folder.id}
          folder={folder}
          level={0}
          syncedIds={syncedIds}
          onToggle={toggle}
          disabled={updateSynced.isPending}
        />
      ))}
      {tree.rootWorkflows.map((workflow) => (
        <SyncWorkflowRow
          key={workflow.id}
          workflow={workflow}
          level={0}
          syncedIds={syncedIds}
          onToggle={toggle}
          disabled={updateSynced.isPending}
        />
      ))}
    </div>
  )
}

interface SyncFolderRowProps {
  folder: SyncTreeFolder
  level: number
  syncedIds: ReadonlySet<string>
  onToggle: (workflowIds: string[], synced: boolean) => void
  disabled: boolean
}

function SyncFolderRow({ folder, level, syncedIds, onToggle, disabled }: SyncFolderRowProps) {
  const [expanded, setExpanded] = useState(true)
  const total = folder.descendantWorkflowIds.length
  const selectedCount = folder.descendantWorkflowIds.filter((id) => syncedIds.has(id)).length
  const headerState = selectedCount === 0 ? false : selectedCount === total ? true : 'indeterminate'

  return (
    <div className='flex flex-col gap-0.5'>
      <div
        className='flex min-w-0 items-center gap-2 py-0.5 text-[var(--text-body)] text-sm'
        style={{ paddingLeft: `${level * INDENT_PER_LEVEL}px` }}
      >
        <Checkbox
          size='sm'
          aria-label={`Sync all in ${folder.name}`}
          checked={headerState}
          onCheckedChange={() => onToggle(folder.descendantWorkflowIds, headerState !== true)}
          disabled={disabled}
        />
        <button
          type='button'
          className='flex min-w-0 items-center gap-1.5 text-left hover:text-[var(--text-primary)]'
          onClick={() => setExpanded((value) => !value)}
        >
          <OverflowText
            label={`${folder.name} (${selectedCount > 0 ? `${selectedCount}/${total}` : total})`}
          >
            {folder.name}{' '}
            <span className='text-[var(--text-muted)]'>
              ({selectedCount > 0 ? `${selectedCount}/${total}` : total})
            </span>
          </OverflowText>
          <ChevronDown
            className={cn(
              'size-[14px] shrink-0 text-[var(--text-icon)] transition-transform',
              expanded && 'rotate-180'
            )}
          />
        </button>
      </div>
      {expanded ? (
        <div className='relative'>
          {/* Vertical guide dropping from the folder's checkbox, mirroring the sidebar tree. */}
          <div
            className='pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--border)]'
            style={{ left: `${level * INDENT_PER_LEVEL + GUIDE_OFFSET}px` }}
          />
          <div className='flex flex-col gap-0.5'>
            {folder.children.map((child) => (
              <SyncFolderRow
                key={child.id}
                folder={child}
                level={level + 1}
                syncedIds={syncedIds}
                onToggle={onToggle}
                disabled={disabled}
              />
            ))}
            {folder.workflows.map((workflow) => (
              <SyncWorkflowRow
                key={workflow.id}
                workflow={workflow}
                level={level + 1}
                syncedIds={syncedIds}
                onToggle={onToggle}
                disabled={disabled}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

interface SyncWorkflowRowProps {
  workflow: SyncWorkflowItem
  level: number
  syncedIds: ReadonlySet<string>
  onToggle: (workflowIds: string[], synced: boolean) => void
  disabled: boolean
}

function SyncWorkflowRow({ workflow, level, syncedIds, onToggle, disabled }: SyncWorkflowRowProps) {
  const itemId = useId()
  return (
    <label
      htmlFor={itemId}
      className={cn(
        'flex min-w-0 items-center gap-2 py-0.5 text-[var(--text-body)] text-sm',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'cursor-pointer hover:text-[var(--text-primary)]'
      )}
      style={{ paddingLeft: `${level * INDENT_PER_LEVEL}px` }}
    >
      <Checkbox
        id={itemId}
        size='sm'
        checked={syncedIds.has(workflow.id)}
        onCheckedChange={(value) => onToggle([workflow.id], value === true)}
        disabled={disabled}
      />
      <OverflowText label={workflow.name} />
    </label>
  )
}
