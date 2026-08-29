/**
 * @vitest-environment node
 *
 * Guards every Google Contacts tool against path traversal through the
 * LLM-writable `resourceName`.
 *
 * `resourceName` is legitimately **multi-segment** (`people/c12345`), so it
 * cannot be guarded as a single segment without breaking every real caller. It
 * goes through `safeUrlPath`, which keeps `/` and rejects only the dot
 * segments — the check that a bare
 * `split('/').map(encodeURIComponent).join('/')` omits.
 */
import { describe, expect, it } from 'vitest'
import {
  discoverPathParams,
  itPassesLegitimateValues,
  itResistsTraversal,
  toolsWithoutPathParams,
} from '@/tools/__tests__/path-safety'
import * as googleContactsTools from '@/tools/google_contacts/index'

const ORIGIN = 'https://people.googleapis.com'

/** The fixed API prefix every route of this service shares. */
const BASE_PATH = '/v1/'

/** The `people/<id>` shape the People API itself returns must round-trip. */
const LEGITIMATE_IDS = [
  'people/c12345',
  'people/c1234567890123456789',
  'people/me',
  'contactGroups/myContacts',
] as const

/**
 * Every tool contributing no path parameter, pinned exactly so none can leave
 * coverage unnoticed. Each entry is one of: a static or query-string-only URL,
 * a `url` declared as a constant string, or an `InternalToolConfig` whose URL is
 * built in `lib/internal/**` and is therefore out of this suite's reach.
 */
const STATIC_URL_TOOLS = [
  'google_contacts_create',
  'google_contacts_list',
  'google_contacts_search',
]

const {
  covered: PATH_PARAMS,
  unbuildable: UNBUILDABLE,
  undiscoverable: UNDISCOVERABLE,
} = discoverPathParams(googleContactsTools, 'google_contacts_')

describe('google contacts resourceName traversal safety', () => {
  it('builds a URL for every tool in the barrel', () => {
    expect(UNBUILDABLE).toEqual([])
  })

  it('probes every declared parameter without one silently dropping out', () => {
    expect(UNDISCOVERABLE).toEqual([])
  })

  it('leaves only genuinely static-URL tools without a path parameter', () => {
    expect(toolsWithoutPathParams(googleContactsTools, 'google_contacts_')).toEqual(
      STATIC_URL_TOOLS
    )
  })

  it('covers every parameter that reaches a URL path segment', () => {
    expect(PATH_PARAMS.length).toBeGreaterThanOrEqual(3)
  })

  describe.each(PATH_PARAMS)('$label', (param) => {
    itResistsTraversal(param, { origin: ORIGIN, basePath: BASE_PATH, preservesWhitespace: true })
    itPassesLegitimateValues(param, { values: LEGITIMATE_IDS })
  })
})
