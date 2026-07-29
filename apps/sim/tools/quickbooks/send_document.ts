import { truncate } from '@sim/utils/string'
import { readResponseToBufferWithLimit } from '@/lib/core/utils/stream-limits'
import type { QuickBooksFileResponse, QuickBooksSendDocumentParams } from '@/tools/quickbooks/types'
import {
  assertQuickBooksPdfResponse,
  buildQuickBooksHeaders,
  buildQuickBooksSendDocumentUrl,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const QUICKBOOKS_MAX_SENT_DOCUMENT_BYTES = 25 * 1024 * 1024

export const quickBooksSendDocumentTool: ToolConfig<
  QuickBooksSendDocumentParams,
  QuickBooksFileResponse
> = {
  id: 'quickbooks_send_document',
  name: 'QuickBooks Send Document',
  description: 'Email a supported QuickBooks transaction and return its rendered PDF',
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
      description: 'QuickBooks transaction type that supports email delivery',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks transaction ID',
    },
    sendTo: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Recipient email address; defaults to the address stored on the transaction',
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
    url: (params) => buildQuickBooksSendDocumentUrl(params).url,
    method: 'POST',
    headers: (params) => {
      const { Authorization } = buildQuickBooksHeaders(params.accessToken)
      return { Authorization, Accept: 'application/octet-stream' }
    },
  },
  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks document parameters are required')
    const { entity } = buildQuickBooksSendDocumentUrl(params)
    const buffer = await readResponseToBufferWithLimit(response, {
      maxBytes: QUICKBOOKS_MAX_SENT_DOCUMENT_BYTES,
      label: 'QuickBooks sent document response',
    })
    if (!response.ok) {
      throw new Error(
        `QuickBooks API error (${response.status}): ${truncate(buffer.toString('utf8'), 500) || response.statusText || 'Request failed'}`
      )
    }
    assertQuickBooksPdfResponse(response, buffer, 'sent document')
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
      description: 'QuickBooks PDF returned after email delivery',
      fileConfig: { mimeType: 'application/pdf', extension: 'pdf' },
    },
    entity: { type: 'string', description: 'QuickBooks transaction type' },
    recordId: { type: 'string', description: 'QuickBooks transaction ID' },
  },
}
