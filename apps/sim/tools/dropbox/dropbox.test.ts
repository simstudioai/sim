/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { dropboxCreateSharedLinkTool } from '@/tools/dropbox/create_shared_link'
import { dropboxListFolderTool } from '@/tools/dropbox/list_folder'
import { dropboxSearchTool } from '@/tools/dropbox/search'
import type { ToolConfig } from '@/tools/types'

function resolveRequest<P>(tool: ToolConfig<P>, params: P) {
  const { url, body } = tool.request
  return {
    url: typeof url === 'function' ? url(params) : url,
    body: body?.(params),
  }
}

describe('dropbox_create_shared_link', () => {
  it('returns the existing link that Dropbox nests under the shared_link_already_exists union', async () => {
    const existing = {
      '.tag': 'file',
      url: 'https://www.dropbox.com/s/abc/report.pdf?dl=0',
      name: 'report.pdf',
      path_lower: '/report.pdf',
      link_permissions: { can_revoke: true, resolved_visibility: { '.tag': 'public' } },
    }
    const response = Response.json(
      {
        error_summary: 'shared_link_already_exists/metadata/..',
        error: {
          '.tag': 'shared_link_already_exists',
          shared_link_already_exists: { '.tag': 'metadata', metadata: existing },
        },
      },
      { status: 409 }
    )

    const result = await dropboxCreateSharedLinkTool.transformResponse?.(response)

    expect(result?.success).toBe(true)
    expect(result?.output.sharedLink?.url).toBe(existing.url)
  })
})

describe('cursor pagination', () => {
  it('continues a folder listing from a cursor', () => {
    expect(
      resolveRequest(dropboxListFolderTool, { path: '/docs', recursive: true, cursor: ' abc ' })
    ).toEqual({
      url: 'https://api.dropboxapi.com/2/files/list_folder/continue',
      body: { cursor: 'abc' },
    })
    expect(resolveRequest(dropboxListFolderTool, { path: '/docs' }).url).toBe(
      'https://api.dropboxapi.com/2/files/list_folder'
    )
  })

  it('continues a search from a cursor', () => {
    expect(resolveRequest(dropboxSearchTool, { query: 'invoice', cursor: 'xyz' })).toEqual({
      url: 'https://api.dropboxapi.com/2/files/search/continue_v2',
      body: { cursor: 'xyz' },
    })
    expect(resolveRequest(dropboxSearchTool, { query: 'invoice' }).url).toBe(
      'https://api.dropboxapi.com/2/files/search_v2'
    )
  })
})
