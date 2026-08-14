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
 * Single-resource surfaces throw this; the list surface skips the row instead
 * so one corrupt row cannot make a whole page unreachable.
 */
export class MalformedCustomToolRowError extends Error {
  constructor(
    readonly toolId: string,
    readonly reason: string
  ) {
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
 * contract-valid.
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
    return {
      reason: parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; '),
    }
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
 * update), where there is no other row to serve and failing loudly is the
 * honest outcome.
 *
 * @throws {MalformedCustomToolRowError} when the row is not contract-valid.
 */
export function toV2CustomTool(row: CustomToolRow): V2CustomTool {
  const result = projectV2CustomTool(row)
  if ('reason' in result) {
    logger.error('Custom tool row cannot be projected onto the v2 contract', {
      ...rowIdentity(row),
      reason: result.reason,
    })
    throw new MalformedCustomToolRowError(row.id, result.reason)
  }
  return result.tool
}

/**
 * Public custom tool projection for the keyset-paginated list.
 *
 * Rows that stay malformed after repair are omitted and logged at `warn` rather
 * than thrown. Throwing here fails the whole page, and because the list is
 * keyset-paginated the caller cannot page past the bad row — every page
 * containing it becomes permanently unreachable. An incomplete page is a real
 * cost, but it is strictly smaller than no page at all, and the omission is
 * recorded server-side with enough identity to find and fix the row.
 *
 * Pagination stays coherent: `nextCursor` is minted from the keys the use case
 * read out of the database, not from this projection, so a skipped row still
 * advances the cursor past itself. The list response carries no total, so no
 * count metadata contradicts a short page — a caller must follow `nextCursor`
 * rather than infer completeness from a page's length.
 */
export function toV2CustomToolList(rows: CustomToolRow[]): V2CustomTool[] {
  const tools: V2CustomTool[] = []

  for (const row of rows) {
    const result = projectV2CustomTool(row)
    if ('reason' in result) {
      logger.warn('Omitted a malformed custom tool row from the v2 list response', {
        ...rowIdentity(row),
        reason: result.reason,
      })
      continue
    }
    tools.push(result.tool)
  }

  return tools
}
