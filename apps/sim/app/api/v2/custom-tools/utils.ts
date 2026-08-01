import type { customTools } from '@sim/db/schema'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import type { NextResponse } from 'next/server'
import type { V2CustomTool } from '@/lib/api/contracts/v2/custom-tools'
import { v2Error } from '@/app/api/v2/lib/response'

/** Shared serialization + error mapping for the v2 custom tool surface. */

/**
 * Classifies a title collision as a conflict so it surfaces as 409 rather than a
 * generic 500. Two distinct failures reach here and both must be covered:
 *
 * - `upsertCustomTools` throws its own message when its in-transaction duplicate
 *   `SELECT` finds one.
 * - Under a concurrent create or rename, both callers pass that `SELECT` too, and
 *   the loser is rejected by `custom_tools_workspace_title_unique` as a raw
 *   Postgres `23505` — whose message matches nothing, which is exactly the race
 *   the message check alone cannot see.
 */
export function v2CustomToolWriteError(error: unknown): NextResponse | null {
  if (getPostgresErrorCode(error) === '23505') {
    return v2Error('CONFLICT', 'A custom tool with that title already exists in this workspace')
  }
  const message = getErrorMessage(error, '')
  if (/already exists in this workspace/i.test(message)) {
    return v2Error('CONFLICT', message)
  }
  return null
}

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
