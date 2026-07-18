import { db } from '@sim/db'
import {
  appRevisionAction,
  appSourceBlob,
  appSourceFile,
  appSourceRevision,
} from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { isAllowedUserPath } from '@/lib/apps/build/prepare-source'
import type { AppActionManifestEntry } from '@/lib/apps/manifest'

export type RevisionSnapshot = {
  files: Record<string, string>
  actions: AppActionManifestEntry[]
}

/**
 * Load immutable revision files + bound actions for server-side App edits.
 * Shared by Full-stack tools and the hosted demo coordinator.
 */
export async function loadRevisionSnapshot(
  projectId: string,
  revisionId: string
): Promise<RevisionSnapshot> {
  const [revision] = await db
    .select({ id: appSourceRevision.id })
    .from(appSourceRevision)
    .where(and(eq(appSourceRevision.id, revisionId), eq(appSourceRevision.projectId, projectId)))
    .limit(1)
  if (!revision) throw new Error('Revision not found')

  const [fileRows, actionRows] = await Promise.all([
    db
      .select({ path: appSourceFile.path, content: appSourceBlob.content })
      .from(appSourceFile)
      .innerJoin(appSourceBlob, eq(appSourceFile.contentHash, appSourceBlob.hash))
      .where(eq(appSourceFile.revisionId, revisionId)),
    db.select().from(appRevisionAction).where(eq(appRevisionAction.revisionId, revisionId)),
  ])
  const files = Object.fromEntries(fileRows.map((row) => [row.path, row.content]))
  const actions: AppActionManifestEntry[] = actionRows.map((row) => ({
    actionId: row.actionId,
    workflowId: row.workflowId,
    deploymentVersionId: row.deploymentVersionId,
    inputSchema: row.inputSchema as AppActionManifestEntry['inputSchema'],
    outputAllowlist: row.outputAllowlist as AppActionManifestEntry['outputAllowlist'],
    executionPolicy: (row.executionPolicy as 'sync' | 'async') || 'sync',
    schemaHash: row.schemaHash,
  }))
  return { files, actions }
}

/** User-editable files only (`src/**`, `public/**`) — never platform-owned paths. */
export function filterAllowedUserFiles(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, content] of Object.entries(files)) {
    if (isAllowedUserPath(path)) {
      out[path] = content
    }
  }
  return out
}
