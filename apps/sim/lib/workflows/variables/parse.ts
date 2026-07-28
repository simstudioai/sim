import type { workflow } from '@sim/db/schema'
import type { Variable } from '@sim/workflow-types/workflow'
import type { InferSelectModel } from 'drizzle-orm'

type DbWorkflowVariables = InferSelectModel<typeof workflow>['variables']

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
