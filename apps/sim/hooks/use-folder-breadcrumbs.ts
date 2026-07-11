import { useMemo, useRef } from 'react'
import type { BreadcrumbItem } from '@/app/workspace/[workspaceId]/components'

/** Minimal shape required to walk a `parentId` chain and render a crumb label. */
export interface BreadcrumbFolder {
  id: string
  name: string
  parentId: string | null
}

/** The subset of `useInlineRename`'s return value the breadcrumb trail needs. */
export interface BreadcrumbRenameState {
  editingId: string | null
  editValue: string
  setEditValue: (value: string) => void
  submitRename: () => void | Promise<void>
  cancelRename: () => void
  startRename: (id: string, currentName: string) => void
}

interface UseFolderBreadcrumbsProps<TFolder extends BreadcrumbFolder> {
  folderById: Map<string, TFolder>
  currentFolderId: string | null
  rootLabel: string
  onNavigateRoot: () => void
  onNavigateFolder: (folderId: string) => void
  breadcrumbRename: BreadcrumbRenameState
  canEdit: boolean
  /** Shows the "Rename" dropdown item while permissions are still resolving, matching existing pages' loading-optimistic UX. */
  canEditLoading?: boolean
}

/**
 * Builds the root-to-current breadcrumb trail for a folder-scoped resource
 * list (files/knowledge/tables), including the inline-rename affordance on
 * the current folder's crumb. Shared by every page that renders a folder
 * breadcrumb so the walk-and-render logic (and the current-folder rename
 * wiring) exists exactly once.
 *
 * `breadcrumbRename` is captured through a ref updated synchronously during
 * render — not listed field-by-field in the memo's dependency array — so the
 * trail always reads the freshest rename state without forcing callers to
 * memoize every function `useInlineRename` returns.
 */
export function useFolderBreadcrumbs<TFolder extends BreadcrumbFolder>({
  folderById,
  currentFolderId,
  rootLabel,
  onNavigateRoot,
  onNavigateFolder,
  breadcrumbRename,
  canEdit,
  canEditLoading = false,
}: UseFolderBreadcrumbsProps<TFolder>): BreadcrumbItem[] {
  const renameRef = useRef(breadcrumbRename)
  renameRef.current = breadcrumbRename

  return useMemo(() => {
    const breadcrumbs: BreadcrumbItem[] = [{ label: rootLabel, onClick: onNavigateRoot }]
    if (!currentFolderId) return breadcrumbs

    // Walk the parentId chain from the current folder up to the root, then
    // reverse so the trail renders root-first.
    const chain: TFolder[] = []
    const visited = new Set<string>()
    let cursor: string | null = currentFolderId
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor)
      const folder = folderById.get(cursor)
      if (!folder) break
      chain.push(folder)
      cursor = folder.parentId
    }
    chain.reverse()

    for (const folder of chain) {
      const isCurrentFolder = folder.id === currentFolderId
      breadcrumbs.push({
        label: folder.name,
        onClick: isCurrentFolder ? undefined : () => onNavigateFolder(folder.id),
        editing:
          isCurrentFolder && renameRef.current.editingId === folder.id
            ? {
                isEditing: true,
                value: renameRef.current.editValue,
                onChange: renameRef.current.setEditValue,
                onSubmit: renameRef.current.submitRename,
                onCancel: renameRef.current.cancelRename,
              }
            : undefined,
        dropdownItems:
          isCurrentFolder && (canEdit || canEditLoading)
            ? [
                {
                  label: 'Rename',
                  disabled: !canEdit,
                  onClick: () => renameRef.current.startRename(folder.id, folder.name),
                },
              ]
            : undefined,
      })
    }
    return breadcrumbs
  }, [
    currentFolderId,
    folderById,
    rootLabel,
    onNavigateRoot,
    onNavigateFolder,
    canEdit,
    canEditLoading,
    breadcrumbRename.editingId,
    breadcrumbRename.editValue,
  ])
}
