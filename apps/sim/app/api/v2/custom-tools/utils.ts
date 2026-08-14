import type { customTools } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import { type V2CustomTool, v2CustomToolSchema } from '@/lib/api/contracts/v2/custom-tools'

/** Shared serialization + error mapping for the v2 custom tool surface. */

const logger = createLogger('V2CustomToolsSerialization')

type CustomToolRow = typeof customTools.$inferSelect

/**
 * A stored row whose `schema` column cannot be projected onto the public
 * contract even after the safe repairs in {@link repairStoredSchema}.
 *
 * Thrown by {@link toV2CustomTool} and consumed by the single-resource route's
 * error policy, which renders it as the same `404 Custom tool not found` the
 * list surface implies by omitting the row. The identifying detail lives in the
 * message and in the structured `error` log at the throw site, so this carries
 * no fields of its own.
 */
export class MalformedCustomToolRowError extends Error {
  constructor(toolId: string, reason: string) {
    super(`Custom tool ${toolId} has a malformed stored schema: ${reason}`)
    this.name = 'MalformedCustomToolRowError'
  }
}

/** Identity fields safe to log for locating a bad row. Never includes `code`. */
function rowIdentity(row: CustomToolRow) {
  return { toolId: row.id, workspaceId: row.workspaceId, title: row.title }
}

/**
 * Safe, information-preserving normalizations for a `schema` column that drifted
 * from the contract shape. Both are hypotheses — nothing here is trusted; the
 * result is still validated against the response contract before it is emitted,
 * so a wrong guess can only downgrade a row to "skipped", never emit bad data.
 *
 * 1. A `schema` persisted as a JSON *string* is parsed. This is a pure encoding
 *    fix: the stored bytes already describe the right object.
 * 2. A declaration missing the top-level `type` discriminator gets `'function'`.
 *    The contract types that field as `z.literal('function')`, so there is
 *    exactly one legal value and filling it invents no information.
 *
 * Neither branch can fire on a row that was already contract-valid: a valid
 * `schema` is an object, never a string, and the contract types its top-level
 * `type` as a required `z.literal('function')`, so it is never `undefined`.
 * Both guards therefore only see shapes that had already failed validation, and
 * repair can only turn a rejection into an acceptance — never alter a row that
 * would have been emitted as stored.
 *
 * Deliberately NOT repaired: `function.parameters.type`, which the contract
 * types as an open `z.string()`. Substituting `'object'` there would be a guess
 * about JSON-Schema semantics that changes how a model calls the tool.
 */
function repairStoredSchema(stored: unknown): { value: unknown; repairs: string[] } {
  const repairs: string[] = []
  let value = stored

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
      repairs.push('parsed-json-string')
    } catch {
      return { value: stored, repairs }
    }
  }

  if (isPlainRecord(value) && value.type === undefined && isPlainRecord(value.function)) {
    value = { ...value, type: 'function' }
    repairs.push('filled-function-discriminator')
  }

  return { value, repairs }
}

/**
 * Projects a stored row onto the public contract, repairing what is safely
 * repairable. Reports a reason instead when the row cannot be made
 * contract-valid, and logs that failure here — one signal per defective row, so
 * both surfaces raise it identically rather than each describing the row in its
 * own words.
 *
 * `workspaceId` and `userId` are internal scoping columns and are not exposed.
 */
function projectV2CustomTool(row: CustomToolRow): { tool: V2CustomTool } | { reason: string } {
  const { value, repairs } = repairStoredSchema(row.schema)

  const parsed = v2CustomToolSchema.safeParse({
    id: row.id,
    title: row.title,
    schema: value,
    code: row.code,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })

  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ')
    logger.error('Custom tool row cannot be projected onto the v2 contract', {
      ...rowIdentity(row),
      reason,
    })
    return { reason }
  }

  if (repairs.length > 0) {
    logger.warn('Repaired a malformed stored custom tool schema', {
      ...rowIdentity(row),
      repairs,
    })
  }

  return { tool: parsed.data }
}

/**
 * Public custom tool projection for single-resource surfaces (read, create,
 * update).
 *
 * @throws {MalformedCustomToolRowError} when the row is not contract-valid.
 * The single-resource routes render that as `404 Custom tool not found`, which
 * is the same answer {@link toV2CustomToolList} gives by omitting the row. A
 * `500` there would leave the two surfaces contradicting each other about one
 * row — listed as absent, fetched as a server fault — and a caller could act on
 * neither. `404` states the one thing that is true of the row on this API: it
 * cannot be addressed here. It also stays actionable, because the recoveries
 * do not go through this projection — `DELETE` removes the row, and a `PATCH`
 * supplying a contract-valid `schema` repairs it and returns `200`.
 */
export function toV2CustomTool(row: CustomToolRow): V2CustomTool {
  const result = projectV2CustomTool(row)
  if ('reason' in result) throw new MalformedCustomToolRowError(row.id, result.reason)
  return result.tool
}

/**
 * Public custom tool projection for the keyset-paginated list.
 *
 * Rows that stay malformed after repair are omitted rather than thrown.
 * Throwing here fails the whole page, and because the list is keyset-paginated
 * the caller cannot page past the bad row — every page containing it becomes
 * permanently unreachable. An incomplete page is a real cost, but it is
 * strictly smaller than no page at all.
 *
 * The page is deliberately **not** drained back up to the requested limit. A
 * page whose rows all skip therefore returns `data: []` with a non-null
 * `nextCursor`, which is safe because `nextCursor` — not page length — is this
 * list's completeness signal:
 *
 * - `listWorkspaceCustomTools` reads `limit + 1` rows and `keysetPage` mints
 *   `nextCursorKeys` from the extra row, so `nextCursor` is null exactly when
 *   the keyset is exhausted, independent of anything this projection does.
 * - Each page resumes strictly after the last row the previous page *read*, not
 *   the last row it *emitted*, so a skipped row still advances the cursor past
 *   itself and is never revisited.
 * - A caller looping `while (nextCursor !== null)` therefore terminates in
 *   `ceil(rows / limit)` requests over any workspace and observes every
 *   projectable row exactly once — including rows that follow an all-skipped
 *   page.
 *
 * Draining instead would mean re-entering the authorized list use case from a
 * presenter, which is the surface adapter re-reading protected data, and it
 * would still need a bound — so a workspace of mostly-defective rows would
 * return a short page anyway, just less predictably. The trap it removes is a
 * caller looping on `data.length`, which this list has never been able to
 * promise: the response carries no total, and page length has always been an
 * artifact of the read rather than a statement about the keyset.
 */
export function toV2CustomToolList(rows: CustomToolRow[]): V2CustomTool[] {
  const tools: V2CustomTool[] = []

  for (const row of rows) {
    const result = projectV2CustomTool(row)
    if ('reason' in result) continue
    tools.push(result.tool)
  }

  return tools
}
