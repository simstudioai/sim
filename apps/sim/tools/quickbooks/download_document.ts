import { truncate } from '@sim/utils/string'
import { readResponseToBufferWithLimit } from '@/lib/core/utils/stream-limits'
import type {
  QuickBooksDownloadDocumentParams,
  QuickBooksFileResponse,
} from '@/tools/quickbooks/types'
import { buildQuickBooksDocumentUrl, buildQuickBooksHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const QUICKBOOKS_MAX_PDF_BYTES = 25 * 1024 * 1024

export const quickBooksDownloadDocumentTool: ToolConfig<
  QuickBooksDownloadDocumentParams,
  QuickBooksFileResponse
> = {
  id: 'quickbooks_download_document',
  name: 'QuickBooks Download Document',
  description: 'Download a supported QuickBooks transaction as a PDF',
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
    entity: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks transaction type that supports PDF download',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks transaction ID',
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
    url: (params) => buildQuickBooksDocumentUrl(params).url,
    method: 'GET',
    headers: (params) => {
      const { Authorization } = buildQuickBooksHeaders(params.accessToken)
      return { Authorization, Accept: 'application/pdf' }
    },
  },
  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks document parameters are required')
    const { entity } = buildQuickBooksDocumentUrl(params)
    const buffer = await readResponseToBufferWithLimit(response, {
      maxBytes: QUICKBOOKS_MAX_PDF_BYTES,
      label: 'QuickBooks PDF response',
    })
    if (!response.ok) {
      throw new Error(
        `QuickBooks API error (${response.status}): ${truncate(buffer.toString('utf8'), 500) || response.statusText || 'Request failed'}`
      )
    }
    return {
      success: true,
      output: {
        file: {
          name: `${entity}-${params.recordId.trim()}.pdf`,
          mimeType: 'application/pdf',
          data: buffer.toString('base64'),
          size: buffer.length,
        },
        entity,
        recordId: params.recordId.trim(),
      },
    }
  },
  outputs: {
    file: {
      type: 'file',
      description: 'QuickBooks transaction PDF',
      fileConfig: { mimeType: 'application/pdf', extension: 'pdf' },
    },
    entity: { type: 'string', description: 'QuickBooks transaction type' },
    recordId: { type: 'string', description: 'QuickBooks transaction ID' },
  },
}
