import { db } from '@sim/db'
import { workspace as workspaceTable } from '@sim/db/schema'
import { inArray } from 'drizzle-orm'
import type { StorageContext } from '@/lib/uploads/config'

/** An id safe to place in a storage key path or a `LIKE` pattern. */
export const STORAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Every storage family whose keys embed their workspace as the second path segment, in the
 * bucket that serves it. A deleted workspace's objects in these families are found by listing,
 * so neither a missing row nor a row written after the deletion read its keys can strand one.
 */
export const WORKSPACE_STORAGE_FAMILIES = [
  { root: 'workspace', context: 'workspace' },
  { root: 'table-import', context: 'table-import' },
  { root: 'execution', context: 'execution' },
  { root: 'table-snapshots', context: 'execution' },
  { root: 'copilot-doc-compiled', context: 'copilot' },
  { root: 'workspace-logos', context: 'workspace-logos' },
  { root: 'knowledge-import', context: 'knowledge-import' },
] as const satisfies readonly { root: string; context: StorageContext }[]

const WORKSPACE_KEYED_ROOTS: ReadonlySet<string> = new Set(
  WORKSPACE_STORAGE_FAMILIES.map(({ root }) => root)
)

/**
 * Exact keys under a workspace-keyed root whose workspace still exists. Such an object stays
 * readable to that workspace's members by key, so no account-deletion purge deletes it, even when
 * the row that named it cascaded away with the account. A workspace segment that is not a valid id
 * is kept too.
 */
export async function keysUnderLiveWorkspaces(keys: readonly string[]): Promise<Set<string>> {
  const kept = new Set<string>()
  const keysByWorkspace = new Map<string, string[]>()
  for (const key of keys) {
    const [root, workspaceId] = key.split('/')
    if (!WORKSPACE_KEYED_ROOTS.has(root)) continue
    if (!workspaceId || !STORAGE_ID_PATTERN.test(workspaceId)) {
      kept.add(key)
      continue
    }
    const workspaceKeys = keysByWorkspace.get(workspaceId)
    if (workspaceKeys) workspaceKeys.push(key)
    else keysByWorkspace.set(workspaceId, [key])
  }
  if (keysByWorkspace.size === 0) return kept
  const live = await db
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    .where(inArray(workspaceTable.id, [...keysByWorkspace.keys()]))
  for (const { id } of live) for (const key of keysByWorkspace.get(id) ?? []) kept.add(key)
  return kept
}
