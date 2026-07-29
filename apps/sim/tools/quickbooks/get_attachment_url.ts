import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import type {
  QuickBooksAttachmentUrlParams,
  QuickBooksAttachmentUrlResponse,
} from '@/tools/quickbooks/types'
import { buildQuickBooksAttachmentUrl, buildQuickBooksHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const QUICKBOOKS_MAX_ATTACHMENT_URL_BYTES = 64 * 1024

export const quickBooksGetAttachmentUrlTool: ToolConfig<
  QuickBooksAttachmentUrlParams,
  QuickBooksAttachmentUrlResponse
> = {
  id: 'quickbooks_get_attachment_url',
  name: 'QuickBooks Get Attachment URL',
  description: 'Get a temporary download URL for a QuickBooks attachment or thumbnail',
  version: '1.0.0',
  oauth: { required: true, provider: 'quickbooks' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for QuickBooks Online',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'QuickBooks company ID returned by Intuit as realmId during OAuth',
    },
    attachmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks Attachable ID',
    },
    thumbnail: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return a thumbnail URL instead of the original attachment URL',
    },
    apiEnvironment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks API environment: production or sandbox. Defaults to production.',
    },
    minorVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks Accounting API minor version. Defaults to 75.',
    },
  },
  request: {
    url: (params) => buildQuickBooksAttachmentUrl(params).url,
    method: 'GET',
    headers: (params) => {
      const { Authorization } = buildQuickBooksHeaders(params.accessToken)
      return { Authorization, Accept: 'text/plain' }
    },
  },
  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks attachment parameters are required')
    const { thumbnail } = buildQuickBooksAttachmentUrl(params)
    const url = (
      await readResponseTextWithLimit(response, {
        maxBytes: QUICKBOOKS_MAX_ATTACHMENT_URL_BYTES,
        label: 'QuickBooks attachment URL response',
      })
    ).trim()
    if (!response.ok) {
      throw new Error(
        `QuickBooks API error (${response.status}): ${url || response.statusText || 'Request failed'}`
      )
    }
    if (!URL.canParse(url)) {
      throw new Error('QuickBooks returned an invalid attachment URL')
    }
    return {
      success: true,
      output: {
        url,
        attachmentId: params.attachmentId.trim(),
        thumbnail,
      },
    }
  },
  outputs: {
    url: { type: 'string', description: 'Temporary QuickBooks attachment URL' },
    attachmentId: { type: 'string', description: 'QuickBooks Attachable ID' },
    thumbnail: { type: 'boolean', description: 'Whether the URL points to a thumbnail' },
  },
}
