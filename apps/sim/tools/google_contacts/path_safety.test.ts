/**
 * @vitest-environment node
 *
 * Guards the People API `resourceName` parameter against path traversal.
 *
 * `resourceName` is `visibility: 'user-or-llm'` and is documented as
 * `people/c123` — a genuinely multi-segment value, so a single-segment guard
 * would break every one of these tools. It goes through `safeUrlPath`, which
 * keeps the `/` as a separator while rejecting dot segments.
 *
 * Interpolated raw, a value of `..` popped the `v1` segment off
 * `people.googleapis.com` once `fetch` normalized the URL, re-aiming the request
 * — with the user's Google OAuth token attached — at another People API
 * resource. `google_contacts_delete` is a DELETE, so the same value destroyed
 * data at the re-aimed address.
 *
 * Every assertion resolves the built URL with `new URL(...)`, the same
 * normalization `fetch` performs, rather than string-matching the template.
 */
import { describe, expect, it } from 'vitest'
import { deleteTool } from '@/tools/google_contacts/delete'
import { getTool } from '@/tools/google_contacts/get'
import { updateTool } from '@/tools/google_contacts/update'
import type { ToolConfig } from '@/tools/types'

type AnyTool = ToolConfig<any, any>

const TOOLS: ReadonlyArray<{ name: string; tool: AnyTool }> = [
  { name: 'google_contacts_get', tool: getTool },
  { name: 'google_contacts_update', tool: updateTool },
  { name: 'google_contacts_delete', tool: deleteTool },
]

const REJECTED = [
  '..',
  '.',
  '  ..  ',
  '\\..\\..',
  '/leading',
  'trailing/',
  'a//b',
  'a/../b',
  'people/../../v1beta1/people',
] as const

/** Encoding already neutralizes these; they must pass but never reshape the path. */
const NEUTRALIZED = ['%2e%2e', '..%2f..', 'x?foo=attacker'] as const

const LEGITIMATE = [
  'people/c123',
  'people/c8384726384726384',
  'contactGroups/myContacts',
  '..foo',
  'foo..',
] as const

/**
 * Returns the path segments with the tool's trailing `:updateContact` /
 * `:deleteContact` verb stripped off the last one, so a built path can be
 * compared segment-for-segment against the value that produced it.
 */
function pathSegments(url: URL): string[] {
  const segments = url.pathname.split('/')
  const last = segments[segments.length - 1]
  return [...segments.slice(0, -1), last.split(':')[0]]
}

function buildUrl(tool: AnyTool, resourceName: string): URL {
  return new URL(
    (tool.request!.url as (p: any) => string)({
      accessToken: 'token',
      resourceName,
      givenName: 'Ada',
    })
  )
}

describe.each(TOOLS)('$name resourceName path safety', ({ tool }) => {
  it.each(REJECTED)('rejects %j instead of letting it reshape the path', (value) => {
    expect(() => buildUrl(tool, value)).toThrow(/resourceName/)
  })

  it.each(NEUTRALIZED)('neutralizes %j without leaving the /v1 prefix', (value) => {
    const url = buildUrl(tool, value)

    expect(url.origin).toBe('https://people.googleapis.com')
    // `v1` is the segment a dot segment would pop; it must still be there, and
    // the value must occupy exactly one segment after it.
    expect(pathSegments(url)).toEqual(['', 'v1', encodeURIComponent(value)])
    expect(url.searchParams.get('foo')).toBeNull()
  })

  it.each(LEGITIMATE)('passes %j through with its separators intact', (value) => {
    const url = buildUrl(tool, value)

    expect(pathSegments(url)).toEqual(['', 'v1', ...value.split('/')])
    expect(url.pathname).not.toContain('%2F')
  })
})
