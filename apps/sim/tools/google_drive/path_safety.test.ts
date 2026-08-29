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
 * Every tool contributing no path parameter, pinned exactly so none can leave
 * coverage unnoticed. Each entry is one of: a static or query-string-only URL,
 * a `url` declared as a constant string, or an `InternalToolConfig` whose URL is
 * built in `lib/internal/**` and is therefore out of this suite's reach.
 */
const STATIC_URL_TOOLS = [
  'google_drive_create_folder',
  'google_drive_download',
  'google_drive_export',
  'google_drive_get_about',
  'google_drive_list',
  'google_drive_move',
  'google_drive_search',
  'google_drive_upload',
]

const {
  covered: PATH_PARAMS,
  unbuildable: UNBUILDABLE,
  undiscoverable: UNDISCOVERABLE,
  withoutPathParams: WITHOUT_PATH_PARAMS,
} = discoverPathParams(googleDriveTools, 'google_drive_')

describe('google drive path-id traversal safety', () => {
  it('builds a URL for every tool in the barrel', () => {
    expect(UNBUILDABLE).toEqual([])
  })

  it('probes every declared parameter without one silently dropping out', () => {
    expect(UNDISCOVERABLE).toEqual([])
  })

  it('leaves only genuinely static-URL tools without a path parameter', () => {
    expect(WITHOUT_PATH_PARAMS).toEqual(STATIC_URL_TOOLS)
  })

  it('covers every parameter that reaches a URL path segment', () => {
    expect(PATH_PARAMS.length).toBeGreaterThanOrEqual(18)
  })

  describe.each(PATH_PARAMS)('$label', (param) => {
    itResistsTraversal(param, { origin: ORIGIN, basePath: BASE_PATH })
    itPassesLegitimateValues(param, { values: LEGITIMATE_IDS })
  })
})
