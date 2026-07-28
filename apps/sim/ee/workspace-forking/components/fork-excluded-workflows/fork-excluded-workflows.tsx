'use client'

import { useId, useMemo, useState } from 'react'
import { Checkbox, ChevronDown, cn, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { useUpdateForkExcludedWorkflows } from '@/ee/workspace-forking/hooks/workspace-fork'
import { useFolders } from '@/hooks/queries/folders'
import { useWorkflows } from '@/hooks/queries/workflows'
import type { WorkflowFolder } from '@/stores/folders/types'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

/** Indent per nesting level, matching the sidebar tree (`TREE_SPACING.INDENT_PER_LEVEL`). */
const INDENT_PER_LEVEL = 20

/** Guide-line offset within a level: the horizontal center of the `sm` checkbox. */
const GUIDE_OFFSET = 7

interface ExcludedWorkflowItem {
  id: string
  name: string
}

interface ExcludedTreeFolder {
  id: string
  name: string
  children: ExcludedTreeFolder[]
  workflows: ExcludedWorkflowItem[]
  /** Every deployed workflow id in this folder's subtree, for the folder-level select-all. */
  descendantWorkflowIds: string[]
}

/**
 * Mirror the sidebar's folder structure for the workspace's DEPLOYED workflows (the only
 * ones that sync). Branches with no deployed workflows anywhere beneath them are pruned;
 * a workflow whose folder was deleted falls into the root bucket so it stays selectable.
 * Folders sort like the sidebar (sortOrder, then name); workflows keep the list order.
 */
export function buildExcludedWorkflowTree(
  workflows: WorkflowMetadata[],
  folders: WorkflowFolder[]
): { folders: ExcludedTreeFolder[]; rootWorkflows: ExcludedWorkflowItem[] } {
  const folderById = new Map(folders.map((folder) => [folder.id, folder]))
  const childFolders = new Map<string | null, WorkflowFolder[]>()
  for (const folder of folders) {
    const parentId = folder.parentId && folderById.has(folder.parentId) ? folder.parentId : null
    const siblings = childFolders.get(parentId)
    if (siblings) siblings.push(folder)
    else childFolders.set(parentId, [folder])
  }

  const workflowsByFolder = new Map<string | null, ExcludedWorkflowItem[]>()
  for (const workflow of workflows) {
    if (!workflow.isDeployed || workflow.archivedAt) continue
    const folderId =
      workflow.folderId && folderById.has(workflow.folderId) ? workflow.folderId : null
    const item: ExcludedWorkflowItem = { id: workflow.id, name: workflow.name }
    const bucket = workflowsByFolder.get(folderId)
    if (bucket) bucket.push(item)
    else workflowsByFolder.set(folderId, [item])
  }

  const sortFolders = (list: WorkflowFolder[]) =>
    [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))

  const buildFolder = (folder: WorkflowFolder): ExcludedTreeFolder | null => {
    const children = sortFolders(childFolders.get(folder.id) ?? [])
      .map(buildFolder)
      .filter((child): child is ExcludedTreeFolder => child !== null)
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
      .filter((folder): folder is ExcludedTreeFolder => folder !== null),
    rootWorkflows: workflowsByFolder.get(null) ?? [],
  }
}

interface ForkExcludedWorkflowsProps {
  workspaceId: string
}

/**
 * The Forks page's "Excluded workflows" section body: the workspace's deployed
 * workflows in their sidebar folder structure, each with a checkbox. Checked =
 * excluded - the workflow never syncs to or from a fork and is not copied into
 * new forks. A folder's checkbox toggles its whole subtree at once (tri-state
 * while partially excluded). Toggles apply immediately.
 */
export function ForkExcludedWorkflows({ workspaceId }: ForkExcludedWorkflowsProps) {
  const workflowsQuery = useWorkflows(workspaceId)
  const foldersQuery = useFolders(workspaceId)
  const updateExcluded = useUpdateForkExcludedWorkflows()

  const workflows = workflowsQuery.data
  const folders = foldersQuery.data

  const excludedIds = useMemo(
    () =>
      new Set((workflows ?? []).filter((workflow) => workflow.forkSyncExcluded).map((w) => w.id)),
    [workflows]
  )
  const tree = useMemo(
    () => buildExcludedWorkflowTree(workflows ?? [], folders ?? []),
    [workflows, folders]
  )

  const toggle = (workflowIds: string[], excluded: boolean) => {
    // Send only real transitions so a folder select-all never writes no-op rows.
    const changed = workflowIds.filter((id) => excludedIds.has(id) !== excluded)
    if (changed.length === 0) return
    updateExcluded.mutate(
      { workspaceId, body: { workflowIds: changed, forkSyncExcluded: excluded } },
      {
        onError: (error) =>
          toast.error(getErrorMessage(error, 'Failed to update excluded workflows')),
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
        <ExcludedFolderRow
          key={folder.id}
          folder={folder}
          level={0}
          excludedIds={excludedIds}
          onToggle={toggle}
          disabled={updateExcluded.isPending}
        />
      ))}
      {tree.rootWorkflows.map((workflow) => (
        <ExcludedWorkflowRow
          key={workflow.id}
          workflow={workflow}
          level={0}
          excludedIds={excludedIds}
          onToggle={toggle}
          disabled={updateExcluded.isPending}
        />
      ))}
    </div>
  )
}

interface ExcludedFolderRowProps {
  folder: ExcludedTreeFolder
  level: number
  excludedIds: ReadonlySet<string>
  onToggle: (workflowIds: string[], excluded: boolean) => void
  disabled: boolean
}

function ExcludedFolderRow({
  folder,
  level,
  excludedIds,
  onToggle,
  disabled,
}: ExcludedFolderRowProps) {
  const [expanded, setExpanded] = useState(true)
  const total = folder.descendantWorkflowIds.length
  const selectedCount = folder.descendantWorkflowIds.filter((id) => excludedIds.has(id)).length
  const headerState = selectedCount === 0 ? false : selectedCount === total ? true : 'indeterminate'

  return (
    <div className='flex flex-col gap-0.5'>
      <div
        className='flex min-w-0 items-center gap-2 py-0.5 text-[var(--text-body)] text-sm'
        style={{ paddingLeft: `${level * INDENT_PER_LEVEL}px` }}
      >
        <Checkbox
          size='sm'
          aria-label={`Exclude all in ${folder.name}`}
          checked={headerState}
          onCheckedChange={() => onToggle(folder.descendantWorkflowIds, headerState !== true)}
          disabled={disabled}
        />
        <button
          type='button'
          className='flex min-w-0 items-center gap-1.5 text-left hover:text-[var(--text-primary)]'
          onClick={() => setExpanded((value) => !value)}
        >
          <span className='min-w-0 truncate'>
            {folder.name}{' '}
            <span className='text-[var(--text-muted)]'>
              ({selectedCount > 0 ? `${selectedCount}/${total}` : total})
            </span>
          </span>
          <ChevronDown
            className={cn(
              'h-[6px] w-[10px] flex-shrink-0 text-[var(--text-icon)] transition-transform',
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
              <ExcludedFolderRow
                key={child.id}
                folder={child}
                level={level + 1}
                excludedIds={excludedIds}
                onToggle={onToggle}
                disabled={disabled}
              />
            ))}
            {folder.workflows.map((workflow) => (
              <ExcludedWorkflowRow
                key={workflow.id}
                workflow={workflow}
                level={level + 1}
                excludedIds={excludedIds}
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

interface ExcludedWorkflowRowProps {
  workflow: ExcludedWorkflowItem
  level: number
  excludedIds: ReadonlySet<string>
  onToggle: (workflowIds: string[], excluded: boolean) => void
  disabled: boolean
}

function ExcludedWorkflowRow({
  workflow,
  level,
  excludedIds,
  onToggle,
  disabled,
}: ExcludedWorkflowRowProps) {
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
        checked={excludedIds.has(workflow.id)}
        onCheckedChange={(value) => onToggle([workflow.id], value === true)}
        disabled={disabled}
      />
      <span className='min-w-0 truncate'>{workflow.name}</span>
    </label>
  )
}
