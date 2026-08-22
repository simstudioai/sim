import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'

const logger = createLogger('WorkflowVariables')

/**
 * A workflow variable as it is stored in `workflow.variables`.
 *
 * The column is schemaless JSONB, so the only guarantee it has is the one every
 * write path applies through {@link normalizeWorkflowVariables}: a record keyed
 * by variable id, each entry carrying its own `id`, `name`, and `type`.
 */
export interface WorkflowVariable {
  id: string
  workflowId?: string
  name: string
  type: string
  value?: unknown
}

/**
 * Projects a declared-typed variable value onto that type.
 *
 * A caller may send `"42"` for a `number` or `"true"` for a `boolean` — the UI
 * edits every variable as text — and the executor reads the stored value
 * without re-coercing it, so the coercion has to happen on the way in. A value
 * that cannot be coerced is stored verbatim rather than rejected: the type is
 * advisory and validated per use site.
 */
export function coerceWorkflowVariableValue(value: unknown, type: string): unknown {
  if (value === undefined) return value
  if (type === 'number') {
    const number = Number(value)
    return Number.isNaN(number) ? value : number
  }
  if (type === 'boolean') {
    const normalized = String(value).trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
    return value
  }
  if (type !== 'array' && type !== 'object') return value

  try {
    const parsed: unknown = JSON.parse(String(value))
    if (type === 'array' && Array.isArray(parsed)) return parsed
    if (type === 'object' && isRecordLike(parsed)) {
      return parsed
    }
  } catch (error) {
    logger.warn('Failed to parse JSON value for workflow variable coercion', {
      error: getErrorMessage(error),
    })
  }
  return value
}

function toVariableEntries(variables: unknown): unknown[] {
  if (Array.isArray(variables)) return variables
  if (isRecordLike(variables)) return Object.values(variables)
  return []
}

/**
 * The single door onto `workflow.variables`.
 *
 * Both write paths — `PATCH /workflows/{id}/variables` and
 * `PUT /workflows/{id}/state` — go through this, so the column can only ever
 * hold one shape. `PUT /state` used to pass the caller's record through
 * verbatim, which let the record key disagree with the entry's own `id` and let
 * a `number` variable hold the string `"42"`; the read side then had to carry
 * defensive parsing for a shape that should never have been written.
 *
 * Entries without a string `id` and `name` are dropped: they cannot be
 * addressed by either key, and a keyless entry is what the defensive read
 * machinery exists to survive.
 *
 * `coerceValues` is set by the caller that is writing the values themselves.
 * `PATCH /variables` coerces per operation and carries untouched entries
 * through unchanged, so re-coercing its whole set would re-parse values that
 * are already in their declared type.
 */
export function normalizeWorkflowVariables(
  variables: unknown,
  options: { coerceValues?: boolean } = {}
): Record<string, WorkflowVariable> {
  const normalized: Record<string, WorkflowVariable> = {}
  for (const entry of toVariableEntries(variables)) {
    if (!isRecordLike(entry)) continue
    const { id, name } = entry
    if (typeof id !== 'string' || typeof name !== 'string') continue
    const type = typeof entry.type === 'string' ? entry.type : 'plain'
    const projected: WorkflowVariable = { ...entry, id, name, type }
    if (options.coerceValues && 'value' in entry) {
      projected.value = coerceWorkflowVariableValue(entry.value, type)
    }
    normalized[id] = projected
  }
  return normalized
}
