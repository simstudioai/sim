import type { CheckboxTreeNode } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/fork-checkbox-tree'

interface CopyableItem {
  id: string
  label: string
  folderId?: string | null
  folderName?: string | null
}

/**
 * One copyable kind as a select-all group. Files nest by folder (sorted by name, files by label)
 * above the root files; a file whose folder was deleted has no folder name and lands at the root,
 * so it stays selectable. Every other kind is a flat list.
 */
export function copyKindNode(
  kind: string,
  label: string,
  items: readonly CopyableItem[],
  nestByFolder = false
): CheckboxTreeNode {
  if (!nestByFolder) {
    return { id: kind, label, children: items.map((item) => ({ id: item.id, label: item.label })) }
  }
  const folders = new Map<string, { id: string; label: string; children: CheckboxTreeNode[] }>()
  const rootFiles: CheckboxTreeNode[] = []
  for (const file of items) {
    const leaf = { id: file.id, label: file.label }
    if (file.folderId && file.folderName) {
      const folder = folders.get(file.folderId) ?? {
        id: `folder:${file.folderId}`,
        label: file.folderName,
        children: [],
      }
      folder.children.push(leaf)
      folders.set(file.folderId, folder)
    } else rootFiles.push(leaf)
  }
  const byLabel = (a: CheckboxTreeNode, b: CheckboxTreeNode) => a.label.localeCompare(b.label)
  const sortedFolders = Array.from(folders.values()).sort(byLabel)
  for (const folder of sortedFolders) folder.children.sort(byLabel)
  return { id: kind, label, children: [...sortedFolders, ...rootFiles.sort(byLabel)] }
}
