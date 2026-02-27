import type { ShortIoDeleteLinkParams } from '@/tools/short_io/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const shortIoDeleteLinkTool: ToolConfig<ShortIoDeleteLinkParams, ToolResponse> = {
  id: 'short_io_delete_link',
  name: 'Short.io Delete Link',
  description: 'Delete a short link by ID (e.g. lnk_abc123_abcdef). Rate limit 20/s.',
  version: '1.0',
  params: {
    apiKey: { type: 'string', required: true, visibility: 'hidden', description: 'Short.io Secret API Key' },
    linkId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Link ID to delete' },
  },
  request: {
    url: (params) => `https://api.short.io/links/${encodeURIComponent(params.linkId)}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: params.apiKey,
    }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const err = await response.text().catch(() => response.statusText)
      return { success: false, output: { success: false, error: err } }
    }
    const data = await response.json().catch(() => ({}))
    return {
      success: true,
      output: {
        success: true,
        deleted: data.success === true,
        idString: data.idString ?? undefined,
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    deleted: { type: 'boolean', description: 'Whether the link was deleted' },
    idString: { type: 'string', description: 'Deleted link ID' },
    error: { type: 'string', description: 'Error message' },
  },
}
