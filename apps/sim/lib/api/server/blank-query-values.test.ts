/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { blankQueryValueValidationError } from '@/lib/api/server/blank-query-values'
import { V2_PARSE_DEFAULTS } from '@/lib/api/server/routes/v2-json-route'

/**
 * A query parameter that is present but blank is a different request from one
 * that was omitted, and no schema can tell the difference on its own: coercion
 * has already turned `''` into `0`, `false`, or a default before validation
 * runs. `?limit=` on the lists that clamp reached SQL as `LIMIT 1`, and
 * `?minCost=` on `/logs` became a live `cost >= 0` filter — both silently wrong
 * pages rather than errors.
 */
describe('blank query values', () => {
  it('rejects an empty value and names the parameter', () => {
    const error = blankQueryValueValidationError({ workspaceId: 'workspace-1', limit: '' })

    expect(error?.issues[0]).toMatchObject({
      path: ['limit'],
      message: 'limit cannot be empty; omit the parameter instead',
    })
  })

  it('treats a whitespace-only value the same way', () => {
    expect(blankQueryValueValidationError({ limit: ' ' })?.issues[0]?.path).toEqual(['limit'])
    expect(blankQueryValueValidationError({ limit: '\t' })?.issues[0]?.path).toEqual(['limit'])
  })

  it('rejects a repeated parameter where any occurrence is blank', () => {
    expect(blankQueryValueValidationError({ folderPaths: ['/live', ''] })?.issues[0]?.path).toEqual(
      ['folderPaths']
    )
  })

  it('accepts a query with no blank values, including a literal zero', () => {
    expect(
      blankQueryValueValidationError({ limit: '0', search: 'a', folderPaths: ['/a', '/b'] })
    ).toBeNull()
    expect(blankQueryValueValidationError({})).toBeNull()
  })

  /**
   * The rule is a v2-surface default rather than something each route opts into,
   * for the same reason the malformed-body envelope is: an opt-in is applied by
   * whoever remembered it, and the params this protects are exactly the ones
   * nobody thought about.
   */
  it('is on for every v2 route through the shared parse defaults', () => {
    expect(V2_PARSE_DEFAULTS.rejectBlankQueryValues).toBe(true)
  })
})
