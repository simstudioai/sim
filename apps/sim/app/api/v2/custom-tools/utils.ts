import type { customTools } from '@sim/db/schema'
import type { V2CustomTool } from '@/lib/api/contracts/v2/custom-tools'

/** Shared serialization + error mapping for the v2 custom tool surface. */

type CustomToolRow = typeof customTools.$inferSelect

/**
 * Public custom tool projection. `workspaceId` and `userId` are internal
 * scoping columns and are not exposed.
 */
export function toV2CustomTool(row: CustomToolRow): V2CustomTool {
  return {
    id: row.id,
    title: row.title,
    schema: row.schema as V2CustomTool['schema'],
    code: row.code,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
