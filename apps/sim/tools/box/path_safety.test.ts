/**
 * @vitest-environment node
 *
 * Guards every Box tool against path traversal through the LLM-writable
 * `fileId` / `folderId` interpolated into `https://api.box.com/2.0/...`.
 *
 * These were bare `params.fileId.trim()` interpolations, so a value of
 * `../../users/me` re-aimed an authenticated request at another Box resource —
 * including `box_delete_file` and `box_delete_folder`, which are DELETEs.
 */
import { describe, expect, it } from 'vitest'
import {
  discoverPathParams,
  itPassesLegitimateValues,
  itResistsTraversal,
  toolsWithoutPathParams,
} from '@/tools/__tests__/path-safety'
import * as boxTools from '@/tools/box/index'

const ORIGIN = 'https://api.box.com'

/** The fixed API prefix every route of this service shares. */
const BASE_PATH = '/2.0/'

/** Box ids are numeric strings; `0` is the real id of the root folder. */
const LEGITIMATE_IDS = ['0', '12345', '987654321012', '1608589364'] as const

/**
 * Tools whose URL embeds no caller-supplied path segment — static or purely
 * query-string driven. Pinned so a tool cannot silently drop out of coverage.
 */
const STATIC_URL_TOOLS = ['box_search']

const { covered: PATH_PARAMS, unbuildable: UNBUILDABLE } = discoverPathParams(boxTools, 'box_')

describe('box path-id traversal safety', () => {
  it('builds a URL for every tool in the barrel', () => {
    expect(UNBUILDABLE).toEqual([])
  })

  it('leaves only genuinely static-URL tools without a path parameter', () => {
    expect(toolsWithoutPathParams(boxTools, 'box_')).toEqual(STATIC_URL_TOOLS)
  })

  it('covers every parameter that reaches a URL path segment', () => {
    expect(PATH_PARAMS.length).toBeGreaterThanOrEqual(7)
  })

  describe.each(PATH_PARAMS)('$label', (param) => {
    itResistsTraversal(param, { origin: ORIGIN, basePath: BASE_PATH })
    itPassesLegitimateValues(param, { values: LEGITIMATE_IDS })
  })
})
