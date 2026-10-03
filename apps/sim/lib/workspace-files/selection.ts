/** A persisted picker value carrying some version of workspace-file identity. */
export interface WorkspaceFileSelection {
  id?: string
  key?: string
  path?: string
  name: string
  folderPath?: string | null
}

/** The canonical workspace-file fields needed to resolve a picker value. */
export interface WorkspaceFileSelectionCandidate extends WorkspaceFileSelection {
  id: string
  key: string
  path: string
}

/**
 * Resolves a persisted picker value against the current workspace-file list.
 *
 * New values carry an id. Older values may carry only a storage key or serve
 * path, and the oldest shape carried only a name. Name fallback is allowed only
 * when it identifies exactly one file (within the stored folder, when present),
 * so two `report.md` files never collapse into one selection.
 */
export function findSelectedWorkspaceFile<T extends WorkspaceFileSelectionCandidate>(
  selection: WorkspaceFileSelection,
  candidates: readonly T[]
): T | undefined {
  if (selection.id) return candidates.find((candidate) => candidate.id === selection.id)

  if (selection.key) {
    const byKey = candidates.find((candidate) => candidate.key === selection.key)
    if (byKey) return byKey
  }

  if (selection.path) {
    const selectedPath = selection.path
    const byPath = candidates.find(
      (candidate) =>
        candidate.path === selectedPath ||
        (() => {
          const pathWithoutQuery = selectedPath.split(/[?#]/, 1)[0]
          try {
            const decodedPath = decodeURIComponent(pathWithoutQuery)
            return decodedPath === candidate.key || decodedPath.endsWith(`/${candidate.key}`)
          } catch {
            return (
              pathWithoutQuery === candidate.key || pathWithoutQuery.endsWith(`/${candidate.key}`)
            )
          }
        })()
    )
    if (byPath) return byPath
  }

  if (selection.key || selection.path) return undefined

  const byName = candidates.filter(
    (candidate) =>
      candidate.name === selection.name &&
      (selection.folderPath == null || candidate.folderPath === selection.folderPath)
  )
  return byName.length === 1 ? byName[0] : undefined
}
