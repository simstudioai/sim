import { type WorkspaceFileRow, workspaceFiles } from '@sim/db/schema'
import { eq } from 'drizzle-orm'

export type FileDiscovery = WorkspaceFileRow['discovery']

/** An upload's initial discovery is independent of its later ownership and storage lifecycle. */
export function defaultFileDiscovery(context: string): FileDiscovery {
  return context === 'workspace' ? 'listed' : 'unlisted'
}

/** Use before pagination, counts, or search; explicit-reference access does not require listing. */
export function fileDiscoveryCondition(discovery: FileDiscovery = 'listed') {
  return eq(workspaceFiles.discovery, discovery)
}
