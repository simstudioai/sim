import type { workflow } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import type { Variable } from '@sim/workflow-types/workflow'
import type { InferSelectModel } from 'drizzle-orm'

type DbWorkflowVariables = InferSelectModel<typeof workflow>['variables']

const VARIABLE_TYPES = new Set<Variable['type']>([
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'plain',
])

/**
 * Parses the persisted `workflow.variables` JSONB column into the canonical
 * `Record<string, Variable>` shape.
 *
 * Tolerates the three forms the column has carried over time: a JSON string, a
 * legacy `Variable[]` array (re-keyed by variable id), and the current record.
 * Returns `undefined` for null/unparseable values so callers can omit the field
 * entirely rather than emitting an empty object.
 */
export function parseWorkflowVariables(
  dbVariables: DbWorkflowVariables
): Record<string, Variable> | undefined {
  if (!dbVariables) return undefined

  try {
    const varsObj = typeof dbVariables === 'string' ? JSON.parse(dbVariables) : dbVariables

    if (Array.isArray(varsObj)) {
      const result: Record<string, Variable> = {}
      for (const v of varsObj) {
        /**
         * Legacy array rows without a usable id would otherwise key the record
         * under the literal string "undefined" and emit `id: undefined`, which
         * violates the export contract's `id: z.string()`.
         */
        if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !v.id) continue
        result[v.id] = {
          id: v.id,
          name: v.name,
          type: v.type,
          value: v.value,
        }
      }
      return result
    }

    if (typeof varsObj === 'object' && varsObj !== null) {
      const result: Record<string, Variable> = {}
      for (const [key, v] of Object.entries(varsObj)) {
        const variable = v as Variable
        result[key] = {
          id: variable.id,
          name: variable.name,
          type: variable.type,
          value: variable.value,
        }
      }
      return result
    }
  } catch {
    return undefined
  }

  return undefined
}

/**
 * Normalizes variables arriving from an *untrusted* import payload into the
 * persisted `Record<string, Variable>` shape, keyed by variable id.
 *
 * Distinct from {@link parseWorkflowVariables}, which reads data this system
 * already wrote: nothing here is assumed well-formed. Accepts both the record
 * form and the legacy array form, and is built on a null-prototype object so a
 * payload keyed `__proto__` is stored as an ordinary own key instead of hitting
 * the `Object.prototype` setter, which would silently discard the variable. An
 * unrecognized `type` falls back to `'string'` rather than being written
 * through to the JSONB column verbatim.
 */
export function normalizeImportedVariables(variables: unknown): Record<string, Variable> {
  /**
   * Assembled on a null-prototype object so a `__proto__` key lands as an
   * ordinary own property instead of invoking the prototype setter, then
   * spread back onto a plain object (spread defines, never assigns, so the key
   * survives) — callers and JSON serialization get an ordinary object.
   */
  const record: Record<string, Variable> = Object.create(null)
  if (!variables || typeof variables !== 'object') return { ...record }

  const entries: Array<[string | undefined, unknown]> = Array.isArray(variables)
    ? variables.map((value) => [undefined, value])
    : Object.entries(variables)

  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object') continue
    const raw = value as Partial<Variable>
    const rawId = typeof raw.id === 'string' ? raw.id.trim() : ''
    const id = rawId || key || generateId()

    record[id] = {
      id,
      name: typeof raw.name === 'string' ? raw.name : id,
      type: raw.type && VARIABLE_TYPES.has(raw.type) ? raw.type : 'string',
      value: raw.value,
    }
  }

  return { ...record }
}
