/**
 * @vitest-environment node
 *
 * Guards every Box Sign tool against path traversal through the LLM-writable
 * `signRequestId`.
 *
 * Before this fix, `signRequestId` reached the path with no treatment at all —
 * not even a `.trim()` — under `/2.0/sign_requests/`, so a value such as
 * `../../users/me` re-aimed an authenticated request at another Box resource.
 * Two of the three call sites are state-changing (`/cancel`, `/resend`).
 *
 * It now goes through `strictUrlPathSegment`, not plain `safeUrlPathSegment`.
 * That distinction is the point of the whitespace pins below: the plain guard
 * *trims* surrounding whitespace, and since `signRequestId` was previously
 * interpolated raw, trimming would newly resolve a padded id to a real request
 * and cancel it. The strict guard refuses instead.
 *
 * The description above is of the defect, not of the current code.
 */
import { describe, expect, it } from 'vitest'
import {
  discoverPathParams,
  itPassesLegitimateValues,
  itResistsTraversal,
  toolsWithoutPathParams,
} from '@/tools/__tests__/path-safety'
import * as boxSignTools from '@/tools/box_sign/index'

const ORIGIN = 'https://api.box.com'

/** The fixed API prefix every route of this service shares. */
const BASE_PATH = '/2.0/sign_requests'

/** Box Sign request ids are UUIDs. */
const LEGITIMATE_IDS = [
  '12345678-1234-1234-1234-123456789012',
  'f3f1e2d3-4c5b-6a79-8899-aabbccddeeff',
] as const

/**
 * Every tool contributing no path parameter, pinned exactly so none can leave
 * coverage unnoticed. Each entry is one of: a static or query-string-only URL,
 * a `url` declared as a constant string, or an `InternalToolConfig` whose URL is
 * built in `lib/internal/**` and is therefore out of this suite's reach.
 */
const STATIC_URL_TOOLS = ['box_sign_create_request', 'box_sign_list_requests']

const {
  covered: PATH_PARAMS,
  unbuildable: UNBUILDABLE,
  undiscoverable: UNDISCOVERABLE,
} = discoverPathParams(boxSignTools, 'box_sign_')

describe('box sign path-id traversal safety', () => {
  it('builds a URL for every tool in the barrel', () => {
    expect(UNBUILDABLE).toEqual([])
  })

  it('probes every declared parameter without one silently dropping out', () => {
    expect(UNDISCOVERABLE).toEqual([])
  })

  it('leaves only genuinely static-URL tools without a path parameter', () => {
    expect(toolsWithoutPathParams(boxSignTools, 'box_sign_')).toEqual(STATIC_URL_TOOLS)
  })

  it('covers every parameter that reaches a URL path segment', () => {
    expect(PATH_PARAMS.length).toBeGreaterThanOrEqual(3)
  })

  describe.each(PATH_PARAMS)('$label', (param) => {
    itResistsTraversal(param, {
      origin: ORIGIN,
      basePath: BASE_PATH,
      rejectsSurroundingWhitespace: ['signRequestId'],
    })
    itPassesLegitimateValues(param, { values: LEGITIMATE_IDS })
  })
})

/**
 * A padded `signRequestId` must not become a successful cancellation.
 *
 * `signRequestId` was interpolated raw before this branch — not even a
 * `.trim()` — so a padded id was percent-encoded to
 * `%20%20<uuid>%20%20`, matched no sign request, and the call failed:
 *
 * ```
 * before: /2.0/sign_requests/%20%2012345678-…-123456789012%20%20/cancel
 * after:  /2.0/sign_requests/12345678-…-123456789012/cancel
 * ```
 *
 * Had the guard simply trimmed, that POST would have stopped failing and
 * started **cancelling a real signature request** — irreversible, from a value
 * the caller never wrote. Box Sign ids are UUIDs, so no legitimate value
 * carries whitespace and refusing costs nothing.
 */
describe('a padded signRequestId cannot become a successful cancellation', () => {
  const PADDED = '  12345678-1234-1234-1234-123456789012  '
  const CLEAN = '12345678-1234-1234-1234-123456789012'

  const STATE_CHANGING = [
    { name: 'box_sign_cancel_request', tool: boxSignTools.boxSignCancelRequestTool },
    { name: 'box_sign_resend_request', tool: boxSignTools.boxSignResendRequestTool },
  ]

  it.each(STATE_CHANGING)('$name refuses a padded signRequestId', ({ tool }) => {
    expect(() =>
      (tool.request?.url as (p: Record<string, unknown>) => string)({
        accessToken: 't',
        signRequestId: PADDED,
      })
    ).toThrow(/signRequestId cannot have leading or trailing whitespace/)
  })

  it.each(STATE_CHANGING)('$name still accepts the unpadded id', ({ tool }) => {
    const url = new URL(
      (tool.request?.url as (p: Record<string, unknown>) => string)({
        accessToken: 't',
        signRequestId: CLEAN,
      })
    )

    expect(url.pathname).toContain(`/2.0/sign_requests/${CLEAN}`)
  })
})
