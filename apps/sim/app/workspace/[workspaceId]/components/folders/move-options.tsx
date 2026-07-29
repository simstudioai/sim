import type { ReactNode } from 'react'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@sim/emcn'
import { Folder } from '@sim/emcn/icons'
import type { WorkflowFolder } from '@/stores/folders/types'

export interface MoveOptionNode {
  value: string
  label: string
  children: MoveOptionNode[]
}

/**
 * Sentinel for "the workspace root" in a move submenu. A folder id can never be empty, so
 * this cannot collide with a real destination.
 */
export const ROOT_MOVE_OPTION_VALUE = '__root__'

/** Decodes a selected move-option value back into a `folderId` / `parentId`. */
export function parseMoveOptionValue(optionValue: string): string | null {
  return optionValue === ROOT_MOVE_OPTION_VALUE ? null : optionValue
}

export interface BuildMoveOptionsParams {
  folders: WorkflowFolder[]
  rootLabel: string
  /**
   * Folder ids that must not appear as destinations — the folder being moved and every
   * folder beneath it, which would otherwise close a cycle. Build the subtree half with
   * {@link buildDescendantIndex}.
   */
  excludedFolderIds?: ReadonlySet<string>
}

/**
 * Builds the folder tree offered by a "Move to" submenu, always led by the root option.
 *
 * Children are indexed by parent once so the tree walk stays linear in the number of
 * folders rather than re-filtering the whole list at every level.
 */
export function buildMoveOptions({
  folders,
  rootLabel,
  excludedFolderIds,
}: BuildMoveOptionsParams): MoveOptionNode[] {
  const childrenByParent = new Map<string | null, WorkflowFolder[]>()
  for (const folder of folders) {
    if (excludedFolderIds?.has(folder.id)) continue
    const parentId = folder.parentId ?? null
    const siblings = childrenByParent.get(parentId)
    if (siblings) siblings.push(folder)
    else childrenByParent.set(parentId, [folder])
  }

  const buildSubtree = (parentId: string | null): MoveOptionNode[] =>
    [...(childrenByParent.get(parentId) ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((folder) => ({
        value: folder.id,
        label: folder.name,
        children: buildSubtree(folder.id),
      }))

  return [{ value: ROOT_MOVE_OPTION_VALUE, label: rootLabel, children: [] }, ...buildSubtree(null)]
}

/**
 * Indexes every folder's transitive descendants once, so excluding a moved folder's subtree
 * from {@link buildMoveOptions} (and rejecting a cyclic drop target) stays O(1) per
 * candidate instead of re-walking the tree. `seen` terminates a cycle, which the DB permits
 * between constraint checks.
 */
export function buildDescendantIndex(folders: WorkflowFolder[]): Map<string, Set<string>> {
  const childrenByParent = new Map<string, string[]>()
  for (const folder of folders) {
    if (!folder.parentId) continue
    const children = childrenByParent.get(folder.parentId)
    if (children) children.push(folder.id)
    else childrenByParent.set(folder.parentId, [folder.id])
  }

  const result = new Map<string, Set<string>>()
  const collect = (folderId: string, seen: Set<string>): Set<string> => {
    const cached = result.get(folderId)
    if (cached) return cached
    if (seen.has(folderId)) return new Set<string>()

    const nextSeen = new Set(seen)
    nextSeen.add(folderId)
    const descendants = new Set<string>()
    for (const childId of childrenByParent.get(folderId) ?? []) {
      if (nextSeen.has(childId)) continue
      descendants.add(childId)
      for (const nestedId of collect(childId, nextSeen)) descendants.add(nestedId)
    }
    result.set(folderId, descendants)
    return descendants
  }

  for (const folder of folders) collect(folder.id, new Set<string>())
  return result
}

/**
 * Renders one move target. A leaf is a plain item; a folder with children becomes a submenu
 * whose own "Move here" entry leads its children, so an intermediate folder is still
 * selectable while remaining traversable.
 */
export function renderMoveOption(
  option: MoveOptionNode,
  onMove: (value: string) => void
): ReactNode {
  if (option.children.length === 0) {
    return (
      <DropdownMenuItem key={option.value} onSelect={() => onMove(option.value)}>
        <Folder />
        {option.label}
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenuSub key={option.value}>
      <DropdownMenuSubTrigger>
        <Folder />
        {option.label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem onSelect={() => onMove(option.value)}>Move here</DropdownMenuItem>
        <DropdownMenuSeparator />
        {option.children.map((child) => renderMoveOption(child, onMove))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/**
 * Renders a whole "Move to" submenu body: the root destination first, then the folder tree.
 * Shared so every row menu that offers a move renders the same structure.
 */
export function renderMoveOptions(
  options: MoveOptionNode[],
  onMove: (value: string) => void
): ReactNode {
  if (options.length === 0) return null
  return (
    <>
      <DropdownMenuItem onSelect={() => onMove(options[0].value)}>
        <Folder />
        {options[0].label}
      </DropdownMenuItem>
      {options.length > 1 && <DropdownMenuSeparator />}
      {options.slice(1).map((option) => renderMoveOption(option, onMove))}
    </>
  )
}
