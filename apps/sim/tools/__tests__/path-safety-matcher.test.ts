/**
 * @vitest-environment node
 *
 * Contract for `namesParam`, the matcher behind every "names the parameter"
 * assertion in the path-safety suites.
 *
 * It gets its own test because the assertion it powers is only as strong as it
 * is, and the previous substring implementation passed all seven suites while
 * accepting a message that named the **wrong** parameter. A weakness here is
 * invisible everywhere else.
 */
import { describe, expect, it } from 'vitest'
import { namesParam } from '@/tools/__tests__/path-safety'

describe('namesParam', () => {
  it.each([
    ['projectId must not have leading or trailing whitespace', 'projectId'],
    ['signRequestId must not have leading or trailing whitespace', 'signRequestId'],
    ['bucket cannot contain a path separator', 'bucket'],
    ['path cannot contain an empty or whitespace-only path segment', 'path'],
    ['tableId cannot be "." (path traversal is not allowed)', 'tableId'],
    ['Invalid table: must start with a letter or underscore', 'table'],
  ])('accepts %j as naming %j', (message, paramName) => {
    expect(namesParam(message, paramName)).toBe(true)
  })

  /**
   * A stricter service validator spells the name as prose. Joining adjacent
   * tokens is what keeps that a correct naming rather than a near-miss.
   */
  it('accepts a prose spelling split across words', () => {
    expect(namesParam('Invalid function name: must contain only letters', 'functionName')).toBe(
      true
    )
  })

  /** Each of these was accepted by the previous substring implementation. */
  it.each([
    ['a generic message', 'Invalid input', 'id'],
    ['a message naming a different parameter', 'projectId cannot be ".."', 'id'],
    ['a longer parameter name containing this one', 'tableId cannot be "."', 'table'],
    ['the name as a substring of an unrelated word', 'pathological failure', 'path'],
  ])('rejects %s', (_label, message, paramName) => {
    expect(namesParam(message, paramName)).toBe(false)
  })

  it('rejects an unrelated message outright', () => {
    expect(namesParam('Something went wrong', 'path')).toBe(false)
  })
})
