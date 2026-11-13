import { triggersMock } from '@sim/testing/mocks/triggers.mock'
import { describe, expect, it, vi } from 'vitest'
import type { BlockConfig } from '@/blocks/types'

vi.mock('@/triggers', () => triggersMock)

import { GoogleDriveBlock } from '@/blocks/blocks/google_drive'

/** The block's `tools.config.params` mapper, which every block under test defines. */
function requireParamsMapper(block: BlockConfig) {
  const mapper = block.tools.config?.params
  if (!mapper) throw new Error(`${block.type} has no params mapper`)
  return mapper
}

const paginationCases = [
  { operation: 'list', subBlockId: 'pageToken' },
  { operation: 'search', subBlockId: 'searchPageToken' },
  { operation: 'list_permissions', subBlockId: 'permissionsPageToken' },
  { operation: 'list_revisions', subBlockId: 'revisionsPageToken' },
  { operation: 'list_comments', subBlockId: 'commentsPageToken' },
] as const

describe('GoogleDriveBlock pagination', () => {
  const buildParams = requireParamsMapper(GoogleDriveBlock)

  describe.each(paginationCases)('$operation', ({ operation, subBlockId }) => {
    /**
     * `pageToken` is the canonical tool param, so the `list` case would forward
     * through `...rest` even without the mapper. The per-operation ids are the
     * ones the mapper has to translate, and none of them may survive as-is.
     */
    it('forwards the page token to the tool under its own id', () => {
      const params = buildParams({ operation, [subBlockId]: 'token-abc' }, undefined as never)

      expect(params).toMatchObject({ pageToken: 'token-abc' })
      if (subBlockId !== 'pageToken') expect(params[subBlockId]).toBeUndefined()
    })
  })

  it('does not leak a page token into operations that do not paginate', () => {
    expect(
      buildParams({ operation: 'get_file', pageToken: 'token-abc' }, undefined as never).pageToken
    ).toBeUndefined()
  })

  /**
   * `shouldSerializeSubBlock` short-circuits for `advanced` fields in basic display
   * mode without evaluating `condition`, so a page token typed under one operation
   * genuinely reaches `inputs` after the user switches to another. The mapper must
   * pick the token belonging to the operation being run and drop the rest.
   */
  describe.each(paginationCases.filter(({ subBlockId }) => subBlockId !== 'pageToken'))(
    '$subBlockId left over from a previous operation',
    ({ subBlockId }) => {
      it.each(['upload', 'get_file', 'list'])('is dropped under %s', (operation) => {
        const params = buildParams({ operation, [subBlockId]: 'stale' }, undefined as never)

        expect(params.pageToken).toBeUndefined()
        expect(params[subBlockId]).toBeUndefined()
      })
    }
  )

  it('prefers the operation-owned token when a stale sibling is also present', () => {
    const params = buildParams(
      {
        operation: 'search',
        searchPageToken: 'search-token',
        commentsPageToken: 'stale',
        pageToken: 'stale-canonical',
      },
      undefined as never
    )

    expect(params.pageToken).toBe('search-token')
    expect(params.commentsPageToken).toBeUndefined()
    expect(params.searchPageToken).toBeUndefined()
  })
})

/**
 * On an agent call the model supplies `pageSize`/`pageToken`/`query` under the tool's own names;
 * the per-operation fields (`permissionsPageSize`, `searchPageToken`, `searchQuery`) are never rendered.
 */
describe('GoogleDriveBlock agent tool calls', () => {
  const buildParams = requireParamsMapper(GoogleDriveBlock)
  const agentCall = (operation: string, args: Record<string, unknown>): Record<string, unknown> => {
    const inputs = { ...args, operation }
    return { ...inputs, ...buildParams(inputs, { operation }) }
  }

  it.each(['search', 'list_permissions', 'list_revisions', 'list_comments'])(
    'keeps the model pageSize and pageToken on %s',
    (operation) => {
      const mapped = agentCall(operation, { fileId: 'f-1', pageSize: 5, pageToken: 'next' })
      expect(mapped.pageSize).toBe(5)
      expect(mapped.pageToken).toBe('next')
    }
  )

  it('keeps the model query on search', () => {
    expect(agentCall('search', { query: 'budget' }).query).toBe('budget')
  })

  it('drops a list page token left over on the canvas under search', () => {
    expect(buildParams({ operation: 'search', pageToken: 'stale' }).pageToken).toBeUndefined()
  })
})
