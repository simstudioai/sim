/**
 * @vitest-environment node
 *
 * Guards every Google Drive tool against path traversal through an
 * LLM-writable id interpolated into the request path.
 *
 * `fileId`, `permissionId`, `commentId` and `revisionId` are all
 * `visibility: 'user-or-llm'`, so prompt injection controls them. They were
 * interpolated as a bare `params.fileId?.trim()`: optional chaining guards
 * `undefined`, not the *type* (a `<Block.output>` resolving to a number threw a
 * raw `TypeError`) and nothing at all guarded the value, so an unencoded `/`
 * silently re-aimed the request — carrying the user's Drive OAuth token — at
 * another resource, including on DELETE.
 */
import { describe, expect, it } from 'vitest'
import {
  discoverPathParams,
  itPassesLegitimateValues,
  itResistsTraversal,
  toolsWithoutPathParams,
} from '@/tools/__tests__/path-safety'
import * as googleDriveTools from '@/tools/google_drive/index'

const ORIGIN = 'https://www.googleapis.com'

/** The fixed API prefix every route of this service shares. */
const BASE_PATH = '/drive/v3/'

/** Real Drive ids: base64url alphabet, so `-` and `_` must survive intact. */
const LEGITIMATE_IDS = [
  '1a2B3c4D5e6F7g8H9i0JkLmNoPqRsTuVw',
  '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
  'file-with-dashes_and_underscores',
  '0AJ1x2y3z4A9PVA',
  'anAlphaNumericId123',
] as const

/**
 * Tools whose URL embeds no caller-supplied path segment — static or purely
 * query-string driven. Pinned so a tool cannot silently drop out of coverage.
 */
const STATIC_URL_TOOLS = ['google_drive_get_about', 'google_drive_list', 'google_drive_search']

const { covered: PATH_PARAMS, unbuildable: UNBUILDABLE } = discoverPathParams(
  googleDriveTools,
  'google_drive_'
)

describe('google drive path-id traversal safety', () => {
  it('builds a URL for every tool in the barrel', () => {
    expect(UNBUILDABLE).toEqual([])
  })

  it('leaves only genuinely static-URL tools without a path parameter', () => {
    expect(toolsWithoutPathParams(googleDriveTools, 'google_drive_')).toEqual(STATIC_URL_TOOLS)
  })

  it('covers every parameter that reaches a URL path segment', () => {
    expect(PATH_PARAMS.length).toBeGreaterThanOrEqual(18)
  })

  describe.each(PATH_PARAMS)('$label', (param) => {
    itResistsTraversal(param, { origin: ORIGIN, basePath: BASE_PATH })
    itPassesLegitimateValues(param, { values: LEGITIMATE_IDS })
  })
})
