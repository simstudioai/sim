import { workspaceFiles } from '@sim/db/schema'
import { eq, inArray, isNull } from 'drizzle-orm'

/** Owned durable files, including unlisted resources. Discovery callers additionally filter membership. */
export function activeWorkspaceFileConditions(workspaceIds: string[]) {
  return [
    inArray(workspaceFiles.workspaceId, workspaceIds),
    eq(workspaceFiles.context, 'workspace'),
    isNull(workspaceFiles.deletedAt),
  ]
}
