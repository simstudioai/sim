import { describe, expect, it } from 'vitest'
import { INT4_MAX } from '@/lib/api/contracts/primitives'
import {
  v2RollbackWorkflowContract,
  v2WorkflowVersionCursorSchema,
} from '@/lib/api/contracts/v2/workflows'

/**
 * The v2 deployment requests carry at most one meaningful field each, and every
 * one of them has a legitimate "omitted" meaning. A stripping schema therefore
 * cannot tell a deliberate omission from a misspelled key, so it answers 200
 * having done something other than what the caller asked for. These pin the
 * strictness that makes the two distinguishable, plus the `integer` bound every
 * caller-supplied deployment version has to respect before it reaches SQL.
 */
describe('v2 deployment request contracts', () => {
  const rollbackBody = v2RollbackWorkflowContract.body

  /**
   * The one behavior strictness must not take away: rollback with no body at
   * all still means "reactivate the version preceding the active one".
   */
  it('keeps an omitted rollback version meaning the previous version', () => {
    expect(rollbackBody.parse(undefined)).toEqual({})
    expect(rollbackBody.parse({})).toEqual({})
  })

  it('rejects a rollback version past the range its column can hold', () => {
    expect(rollbackBody.safeParse({ version: INT4_MAX }).success).toBe(true)
    expect(rollbackBody.safeParse({ version: INT4_MAX + 1 }).success).toBe(false)
  })

  it('bounds the version a forged versions cursor can carry into the query', () => {
    expect(v2WorkflowVersionCursorSchema.safeParse({ version: 2 }).success).toBe(true)
    expect(v2WorkflowVersionCursorSchema.safeParse({ version: INT4_MAX + 1 }).success).toBe(false)
    expect(v2WorkflowVersionCursorSchema.safeParse({ version: 0 }).success).toBe(false)
    expect(v2WorkflowVersionCursorSchema.safeParse({ version: 'two' }).success).toBe(false)
    expect(v2WorkflowVersionCursorSchema.safeParse({}).success).toBe(false)
  })
})
