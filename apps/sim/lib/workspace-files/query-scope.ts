import { workspaceFiles } from '@sim/db/schema'
import { eq, inArray, isNull, ne } from 'drizzle-orm'
import { DASHBOARD_CONTENT_TYPE } from '@/lib/dashboards/resource'

/** Durable files available to workspace resource pickers, reference mappings, and fork copies. */
export function activeWorkspaceFileConditions(workspaceIds: string[]) {
  return [
    inArray(workspaceFiles.workspaceId, workspaceIds),
    eq(workspaceFiles.context, 'workspace'),
    isNull(workspaceFiles.deletedAt),
  ]
}

/**
 * A requested content type, or every file except the workspace dashboard's backing file,
 * which is its own resource rather than a listed or searchable file.
 */
export function workspaceFileContentTypeCondition(contentType?: string) {
  return contentType
    ? eq(workspaceFiles.contentType, contentType)
    : ne(workspaceFiles.contentType, DASHBOARD_CONTENT_TYPE)
}
