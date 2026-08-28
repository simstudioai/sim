/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => ({
  getTrigger: () => ({ subBlocks: [] }),
}))

import { GoogleDriveBlock } from '@/blocks/blocks/google_drive'
import { listTool } from '@/tools/google_drive/list'
import { listCommentsTool } from '@/tools/google_drive/list_comments'
import { listPermissionsTool } from '@/tools/google_drive/list_permissions'
import { listRevisionsTool } from '@/tools/google_drive/list_revisions'
import { searchTool } from '@/tools/google_drive/search'

const paginationCases = [
  { operation: 'list', subBlockId: 'pageToken', tool: listTool },
  { operation: 'search', subBlockId: 'searchPageToken', tool: searchTool },
  { operation: 'list_permissions', subBlockId: 'permissionsPageToken', tool: listPermissionsTool },
  { operation: 'list_revisions', subBlockId: 'revisionsPageToken', tool: listRevisionsTool },
  { operation: 'list_comments', subBlockId: 'commentsPageToken', tool: listCommentsTool },
] as const

describe('GoogleDriveBlock pagination', () => {
  const buildParams = GoogleDriveBlock.tools.config.params!

  describe.each(paginationCases)('$operation', ({ operation, subBlockId, tool }) => {
    it('exposes a page token field scoped to the operation', () => {
      expect(GoogleDriveBlock.subBlocks.find(({ id }) => id === subBlockId)).toMatchObject({
        type: 'short-input',
        mode: 'advanced',
        condition: { field: 'operation', value: operation },
      })
    })

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

    it('lets an agent feed a nextPageToken back in', () => {
      expect(tool.params.pageToken?.visibility).toBe('user-or-llm')
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

  it('declares pageToken as a block input', () => {
    expect(GoogleDriveBlock.inputs.pageToken).toBeDefined()
  })
})
