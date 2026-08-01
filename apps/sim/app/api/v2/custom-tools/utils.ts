import type { customTools } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextResponse } from 'next/server'
import type { V2CustomTool } from '@/lib/api/contracts/v2/custom-tools'
import { v2Error } from '@/app/api/v2/lib/response'

/** Shared serialization + error mapping for the v2 custom tool surface. */

/**
 * `upsertCustomTools` reports a title collision as a thrown Error, and the unique
 * index behind it fires on the race the pre-check cannot cover (two concurrent
 * creates of the same title both pass the check, then one insert loses). Classify
 * it as a conflict so that race surfaces as 409 rather than a generic 500.
 */
export function v2CustomToolWriteError(error: unknown): NextResponse | null {
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
