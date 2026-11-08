/** The part of a folder a breadcrumb trail needs. */
export interface ChainFolder {
  id: string
  name: string
  parentId: string | null
}

/**
 * The folders from the root down to `folderId`, outermost first. A folder whose parent no longer
 * exists ends the chain there, as legacy treats it as sitting at the root; a cycle stops it too.
 */
export function folderChain<T extends ChainFolder>(
  folders: Readonly<Record<string, T>> | undefined,
  folderId: string | null | undefined
): T[] {
  const chain: T[] = []
  const seen = new Set<string>()
  let current = folderId ? folders?.[folderId] : undefined
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.unshift(current)
    current = current.parentId ? folders?.[current.parentId] : undefined
  }
  return chain
}
