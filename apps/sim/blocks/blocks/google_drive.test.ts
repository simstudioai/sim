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

    it('forwards the page token to the tool', () => {
      expect(
        buildParams({ operation, [subBlockId]: 'token-abc' }, undefined as never)
      ).toMatchObject({ pageToken: 'token-abc' })
    })

    it('declares pageToken as a user-settable tool param', () => {
      expect(tool.params.pageToken?.visibility).toBe('user-only')
    })
  })

  it('does not leak a page token into operations that do not paginate', () => {
    expect(
      buildParams({ operation: 'get_file', pageToken: 'token-abc' }, undefined as never).pageToken
    ).toBeUndefined()
  })

  it('declares pageToken as a block input', () => {
    expect(GoogleDriveBlock.inputs.pageToken).toBeDefined()
  })
})
