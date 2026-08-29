/**
 * @vitest-environment node
 *
 * Guards every Box Sign tool against path traversal through the LLM-writable
 * `signRequestId`.
 *
 * This one was interpolated with no treatment at all — not even a `.trim()` —
 * into `/2.0/sign_requests/${safeUrlPathSegment(params.signRequestId, 'signRequestId')}`, and two of the three
 * call sites are state-changing (`/cancel`, `/resend`).
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
 * Tools whose URL embeds no caller-supplied path segment — static or purely
 * query-string driven. Pinned so a tool cannot silently drop out of coverage.
 */
const STATIC_URL_TOOLS = ['box_sign_list_requests']

const { covered: PATH_PARAMS, unbuildable: UNBUILDABLE } = discoverPathParams(
  boxSignTools,
  'box_sign_'
)

describe('box sign path-id traversal safety', () => {
  it('builds a URL for every tool in the barrel', () => {
    expect(UNBUILDABLE).toEqual([])
  })

  it('leaves only genuinely static-URL tools without a path parameter', () => {
    expect(toolsWithoutPathParams(boxSignTools, 'box_sign_')).toEqual(STATIC_URL_TOOLS)
  })

  it('covers every parameter that reaches a URL path segment', () => {
    expect(PATH_PARAMS.length).toBeGreaterThanOrEqual(3)
  })

  describe.each(PATH_PARAMS)('$label', (param) => {
    itResistsTraversal(param, { origin: ORIGIN, basePath: BASE_PATH })
    itPassesLegitimateValues(param, { values: LEGITIMATE_IDS })
  })
})
