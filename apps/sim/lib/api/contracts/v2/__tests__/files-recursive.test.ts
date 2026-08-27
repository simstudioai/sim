/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { v2ListFilesQuerySchema } from '@/lib/api/contracts/v2/files'

const WORKSPACE_ID = 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64'

/** Parses what a query string actually delivers: strings, never booleans. */
function parseRecursive(raw: string | undefined) {
  const result = v2ListFilesQuerySchema.safeParse({
    workspaceId: WORKSPACE_ID,
    ...(raw === undefined ? {} : { recursive: raw }),
  })
  return result.success ? result.data.recursive : { error: true as const }
}

describe('v2ListFilesQuerySchema recursive', () => {
  it('omits to undefined so the route can pick a default from the search', () => {
    expect(parseRecursive(undefined)).toBeUndefined()
  })

  /**
   * The bug this guards: `z.coerce.boolean()` is `Boolean(input)` over a query string, so
   * every non-empty spelling — `false` included — arrives as `true`, silently inverting the
   * one value a caller sends explicitly to turn recursion off.
   */
  it('reads "false" as false, not as a non-empty string', () => {
    expect(parseRecursive('false')).toBe(false)
    expect(parseRecursive('0')).toBe(false)
    expect(parseRecursive('no')).toBe(false)
  })

  it('reads the true spellings as true', () => {
    expect(parseRecursive('true')).toBe(true)
    expect(parseRecursive('1')).toBe(true)
    expect(parseRecursive('yes')).toBe(true)
  })

  /** Case-sensitive by design: an unpublished spelling is a 400, never a silent default. */
  it('rejects spellings outside the published vocabulary', () => {
    expect(parseRecursive('True')).toEqual({ error: true })
    expect(parseRecursive('TRUE')).toEqual({ error: true })
    expect(parseRecursive('maybe')).toEqual({ error: true })
    expect(parseRecursive('')).toEqual({ error: true })
  })
})
