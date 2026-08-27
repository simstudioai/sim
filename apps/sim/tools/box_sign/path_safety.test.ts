/**
 * @vitest-environment node
 *
 * Guards every Box Sign tool that interpolates `signRequestId` into its request
 * path against path traversal and query injection.
 *
 * `signRequestId` is `required: true, visibility: 'user-or-llm'` on the get,
 * cancel, and resend tools, and all five tools are reachable from the **Box**
 * block (`blocks/blocks/box.ts` lists `box_sign_*` in `tools.access`). Before
 * the guard the value was interpolated with no encoder at all, so `?` and `#`
 * split the URL zones outright and a bare `.` collapsed
 * `/2.0/sign_requests/{id}` down to `/2.0/sign_requests` — the *list* endpoint,
 * enumerating every sign request in the account with the caller's Box OAuth
 * token attached.
 *
 * `encodeURIComponent` alone is NOT a fix: `.` and `..` are unreserved, so they
 * survive encoding untouched and the WHATWG parser then removes them as dot
 * segments (see `tools/url-path.ts`). Only value rejection works. Every
 * assertion resolves the built URL through `new URL(...)` — the same
 * normalization `fetch` performs — and asserts on the full decoded `pathname`
 * segment list, because string-matching the template is exactly what let this
 * through.
 */
import { describe, expect, it } from 'vitest'
import {
  boxSignCancelRequestTool,
  boxSignCreateRequestTool,
  boxSignGetRequestTool,
  boxSignListRequestsTool,
  boxSignResendRequestTool,
} from '@/tools/box_sign/index'
import type { ToolConfig } from '@/tools/types'

type AnyTool = ToolConfig<any, any>

const ORIGIN = 'https://api.box.com'

/**
 * Vectors the guard must reject outright. `.` and `..` survive every encoding
 * scheme; `a/b` and `..\..` carry a separator into a single-segment parameter;
 * `'  ..  '` is a dot segment wearing copy-paste whitespace.
 */
const REJECTED = ['.', '..', '  ..  ', 'a/b', 'a/../../b', '..\\..'] as const

/**
 * Vectors `encodeURIComponent` genuinely neutralizes into one inert segment.
 * These must NOT throw, but they must also not escape their segment — `%2e%2e`
 * must stay a literal `..` *segment value* rather than being removed, and
 * `x?fields=all` must not split into a query zone.
 */
const NEUTRALIZED = ['%2e%2e', 'x?fields=all', 'x#frag'] as const

/** Real Box sign-request ids. Box documents these as opaque strings; the
 * reference example for `sign_request_id` is `33243242`, and Box also issues
 * UUID-shaped ids. Neither form contains a separator or a dot segment. */
const LEGITIMATE = ['33243242', '12345678-90ab-cdef-1234-567890abcdef'] as const

interface PathToolCase {
  tool: AnyTool
  /** Path segments after `/2.0/sign_requests/{id}`, if any. */
  suffix: readonly string[]
}

const PATH_TOOLS: readonly PathToolCase[] = [
  { tool: boxSignGetRequestTool, suffix: [] },
  { tool: boxSignCancelRequestTool, suffix: ['cancel'] },
  { tool: boxSignResendRequestTool, suffix: ['resend'] },
]

function buildUrl(tool: AnyTool, signRequestId: unknown): string {
  const url = tool.request.url
  return typeof url === 'function'
    ? url({ accessToken: 'TOKEN', signRequestId } as any)
    : (url as string)
}

describe.each(PATH_TOOLS.map((c) => [c.tool.id, c] as const))('%s', (_id, testCase) => {
  const { tool, suffix } = testCase

  it.each(LEGITIMATE)('accepts the legitimate sign request id %j unchanged', (value) => {
    const resolved = new URL(buildUrl(tool, value))

    expect(resolved.origin).toBe(ORIGIN)
    expect(resolved.search).toBe('')
    expect(resolved.pathname.split('/').map(decodeURIComponent)).toEqual([
      '',
      '2.0',
      'sign_requests',
      value,
      ...suffix,
    ])
    expect(buildUrl(tool, value)).toBe(
      [`${ORIGIN}/2.0/sign_requests/${value}`, ...suffix].join('/')
    )
  })

  it.each(REJECTED)('rejects %j', (value) => {
    expect(() => buildUrl(tool, value)).toThrow(/signRequestId/)
  })

  it.each(NEUTRALIZED)('keeps %j inside a single inert path segment', (value) => {
    const resolved = new URL(buildUrl(tool, value))

    expect(resolved.origin).toBe(ORIGIN)
    expect(resolved.search).toBe('')
    expect(resolved.hash).toBe('')
    expect(resolved.pathname.split('/').map(decodeURIComponent)).toEqual([
      '',
      '2.0',
      'sign_requests',
      value,
      ...suffix,
    ])
  })

  it('rejects an empty or missing sign request id', () => {
    expect(() => buildUrl(tool, '')).toThrow(/signRequestId is required/)
    expect(() => buildUrl(tool, undefined)).toThrow(/signRequestId is required/)
  })
})

describe('box_sign tools without a path parameter', () => {
  it('box_sign_create_request posts to the fixed collection URL', () => {
    const resolved = new URL(buildUrl(boxSignCreateRequestTool, undefined))
    expect(resolved.origin).toBe(ORIGIN)
    expect(resolved.pathname.split('/')).toEqual(['', '2.0', 'sign_requests'])
  })

  it('box_sign_list_requests keeps its parameters in the query zone', () => {
    const url = (boxSignListRequestsTool.request.url as (p: any) => string)({
      accessToken: 'TOKEN',
      limit: 10,
      marker: '../../admin',
    })
    const resolved = new URL(url)

    expect(resolved.pathname.split('/')).toEqual(['', '2.0', 'sign_requests'])
    expect(resolved.searchParams.get('marker')).toBe('../../admin')
  })
})
