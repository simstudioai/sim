import { OrchestrationError } from '@/lib/core/orchestration/types'
import { listFoldersForWorkspace } from '@/lib/folders/queries'
import { findActiveTablesByExactName, listTables } from '@/lib/table/service'
import type { TableDefinition } from '@/lib/table/types'

type TableFolder = Awaited<ReturnType<typeof listFoldersForWorkspace>>[number]

/**
 * Resolves the folder a path of folder names leads to from the root: `null` for the root itself,
 * `undefined` when a segment names no folder.
 */
function resolveTableFolderId(
  folders: readonly TableFolder[],
  segments: readonly string[]
): string | null | undefined {
  let current: string | null = null
  for (const segment of segments) {
    const next = folders.find((folder) => folder.parentId === current && folder.name === segment)
    if (!next) return undefined
    current = next.id
  }
  return current
}

/**
 * Resolves a table from its VFS path, `tables/{...folders}/{name}`. A bare name matches the one
 * active table of that name anywhere in the tree. Authorization is the caller's: every entry
 * point is a per-resource authorized use case.
 */
export async function resolveTableByVfsName(
  workspaceId: string,
  sourceName: string,
  sourceSegments?: string[]
): Promise<TableDefinition> {
  if (sourceSegments && sourceSegments.length > 1) {
    const path = `tables/${sourceSegments.join('/')}`
    const leaf = sourceSegments[sourceSegments.length - 1]
    const folders = await listFoldersForWorkspace(workspaceId, 'active', 'table')
    const parentId = resolveTableFolderId(folders, sourceSegments.slice(0, -1))
    if (parentId !== undefined) {
      const inParent = (await listTables(workspaceId)).filter(
        (table) => table.name === leaf && (table.folderId ?? null) === parentId
      )
      if (inParent.length === 1) return inParent[0]
      if (resolveTableFolderId(folders, sourceSegments)) {
        throw new OrchestrationError(
          'validation',
          `${path} is a folder; this operation takes a table.`
        )
      }
    }
    throw new OrchestrationError('not_found', `No table or folder found at ${path}`)
  }
  const matches = await findActiveTablesByExactName(workspaceId, sourceName)
  if (matches.length > 1) {
    throw new OrchestrationError('conflict', `Table path is ambiguous: tables/${sourceName}`)
  }
  const table = matches[0]
  if (!table) throw new OrchestrationError('not_found', `Table not found at tables/${sourceName}`)
  return table
}
