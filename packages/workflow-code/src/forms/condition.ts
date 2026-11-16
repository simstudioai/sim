/**
 * The condition block's `else: true` sugar, both directions: the last `else` row with an empty
 * value prints as `else: true`, and `else: true` written last compiles to that row.
 */

import type { Node } from '@babel/types'
import type { WorkflowBranchKind } from '@sim/workflow-types/workflow'
import type { CanonicalBranchRow } from '../model'

/** The branch key a condition with two or more branches ends with. */
export const ELSE_KEY = 'else'

/** Whether row `index` of `count` prints as `else: true`. */
export function printsAsElseTrue(
  kind: WorkflowBranchKind,
  row: CanonicalBranchRow,
  index: number,
  count: number
): boolean {
  return kind === 'condition' && row.key === ELSE_KEY && index === count - 1 && row.value === ''
}

/** Whether a written branch entry is `else: true` in last place, the empty else row. */
export function isElseTrue(
  kind: WorkflowBranchKind,
  key: string,
  isLast: boolean,
  value: Node
): boolean {
  return (
    kind === 'condition' &&
    key === ELSE_KEY &&
    isLast &&
    value.type === 'BooleanLiteral' &&
    value.value
  )
}
