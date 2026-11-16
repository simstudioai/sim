/**
 * Narrowing helpers over the catalog's condition shapes (`@sim/workflow-code` catalog types).
 */

import type { CatalogCondition, SubBlockConditionClause } from '@sim/workflow-code'

/** A data condition the evaluator can read. */
export function isConditionClause(
  value: CatalogCondition | boolean | undefined
): value is SubBlockConditionClause {
  return typeof value === 'object' && 'field' in value
}

/** A function condition the projection could not evaluate (`{ opaque: true }`). */
export function isOpaque(value: CatalogCondition | boolean | undefined): boolean {
  return typeof value === 'object' && 'opaque' in value
}
