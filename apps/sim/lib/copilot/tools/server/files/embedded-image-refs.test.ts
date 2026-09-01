/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetFileMetadataById } = vi.hoisted(() => ({
  mockGetFileMetadataById: vi.fn(),
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataById: mockGetFileMetadataById,
}))

import { findUnembeddableImageRefs } from '@/lib/copilot/tools/server/files/embedded-image-refs'

const WORKSPACE_ID = 'W1'

describe('findUnembeddableImageRefs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('flags embeds that are not workspace files in this workspace', async () => {
    mockGetFileMetadataById.mockImplementation(async (id: string) => {
      if (id === 'wf_here') return { context: 'workspace', workspaceId: WORKSPACE_ID }
      if (id === 'wf_elsewhere') return { context: 'workspace', workspaceId: 'W2' }
      if (id === 'wf_chat') return { context: 'mothership', workspaceId: WORKSPACE_ID }
      return null
    })

    const content = `![a](/api/files/view/wf_here) ![b](/api/files/view/wf_elsewhere)
      ![c](/api/files/view/wf_chat) ![d](/api/files/view/wf_missing)`

    expect((await findUnembeddableImageRefs(content, WORKSPACE_ID)).sort()).toEqual([
      'wf_chat',
      'wf_elsewhere',
      'wf_missing',
    ])
  })

  it('never warns about a url the document only mentions', async () => {
    const content = 'Call `/api/files/view/{id}`; see [the docs](/api/files/view/wf_linked).'

    expect(await findUnembeddableImageRefs(content, WORKSPACE_ID)).toEqual([])
    expect(mockGetFileMetadataById).not.toHaveBeenCalled()
  })

  /**
   * The export bundler resolves an embed by its stored id, so reporting the same embed as one that
   * will not survive an export would contradict what the export actually does with it.
   */
  it('resolves a percent-encoded embed by its stored id, like the export does', async () => {
    mockGetFileMetadataById.mockImplementation(async (id: string) =>
      id === 'wf_abc' ? { context: 'workspace', workspaceId: WORKSPACE_ID } : null
    )

    expect(await findUnembeddableImageRefs('![a](/api/files/view/wf%5Fabc)', WORKSPACE_ID)).toEqual(
      []
    )
    expect(mockGetFileMetadataById).toHaveBeenCalledWith('wf_abc')
  })
})
