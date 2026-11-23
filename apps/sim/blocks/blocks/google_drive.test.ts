import { triggersMock } from '@sim/testing/mocks/triggers.mock'
import { describe, expect, it, vi } from 'vitest'
import type { BlockToolParamsContext } from '@/blocks/types'

vi.mock('@/triggers', () => triggersMock)

import { GoogleDriveBlock } from '@/blocks/blocks/google_drive'

/** The block's `tools.config.params` mapper; `context` is set on a tool call, absent on the canvas. */
const buildParams = (
  inputs: Record<string, unknown>,
  context?: BlockToolParamsContext
): Record<string, unknown> => GoogleDriveBlock.tools.config?.params?.(inputs, context) ?? {}

const paginationCases = [
  { operation: 'list', subBlockId: 'pageToken' },
  { operation: 'search', subBlockId: 'searchPageToken' },
  { operation: 'list_permissions', subBlockId: 'permissionsPageToken' },
  { operation: 'list_revisions', subBlockId: 'revisionsPageToken' },
  { operation: 'list_comments', subBlockId: 'commentsPageToken' },
] as const

describe('GoogleDriveBlock pagination', () => {
  describe.each(paginationCases)('$operation', ({ operation, subBlockId }) => {
    /**
     * `pageToken` is the canonical tool param, so the `list` case would forward
     * through `...rest` even without the mapper. The per-operation ids are the
     * ones the mapper has to translate, and none of them may survive as-is.
     */
    it('forwards the page token to the tool under its own id', () => {
      const params = buildParams({ operation, [subBlockId]: 'token-abc' })

      expect(params).toMatchObject({ pageToken: 'token-abc' })
      if (subBlockId !== 'pageToken') expect(params[subBlockId]).toBeUndefined()
    })
  })

  it('does not leak a page token into operations that do not paginate', () => {
    expect(buildParams({ operation: 'get_file', pageToken: 'token-abc' }).pageToken).toBeUndefined()
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
        const params = buildParams({ operation, [subBlockId]: 'stale' })

        expect(params.pageToken).toBeUndefined()
        expect(params[subBlockId]).toBeUndefined()
      })
    }
  )

  it('prefers the operation-owned token when a stale sibling is also present', () => {
    const params = buildParams({
      operation: 'search',
      searchPageToken: 'search-token',
      commentsPageToken: 'stale',
      pageToken: 'stale-canonical',
    })

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
  /** A stored agent tool keeps its operation on the tool, so it reaches the mapper only in `context`. */
  const agentCall = (
    operation: string,
    args: Record<string, unknown>
  ): Record<string, unknown> => ({
    ...args,
    ...buildParams(args, { operation }),
  })

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

  /** A stored agent tool keeps its operation on the tool, not in the args the mapper receives. */
  it('keeps the model pageToken when the args carry no operation', () => {
    const args = { fileId: 'f-1', pageToken: 'next' }
    expect({ ...args, ...buildParams(args, { operation: 'list_comments' }) }.pageToken).toBe('next')
  })

  it('sends the file picked on the tool row over the fileId the model supplies', () => {
    expect(agentCall('get_file', { getFileId: 'picked-1', fileId: 'model-1' }).fileId).toBe(
      'picked-1'
    )
  })

  it('sends the folders picked on the tool row over the ids the model supplies', () => {
    const moved = agentCall('move', {
      fileId: 'f-1',
      moveDestFolderId: 'picked-dest',
      destinationFolderId: 'model-dest',
    })
    expect(moved.destinationFolderId).toBe('picked-dest')
    expect(
      agentCall('list', { listFolderId: 'picked-folder', folderId: 'model-folder' }).folderId
    ).toBe('picked-folder')
  })

  it('keeps the model fileId when the tool row has no file picked', () => {
    expect(agentCall('get_file', { fileId: 'model-1' }).fileId).toBe('model-1')
  })

  it('keeps the export format the model supplies', () => {
    expect(agentCall('export', { fileId: 'f-1', mimeType: 'text/plain' }).mimeType).toBe(
      'text/plain'
    )
  })

  it('keeps boolean args the model sends as booleans', () => {
    expect(agentCall('update', { fileId: 'f-1', starred: true }).starred).toBe(true)
    expect(agentCall('move', { fileId: 'f-1', removeFromCurrent: false }).removeFromCurrent).toBe(
      false
    )
  })
})
