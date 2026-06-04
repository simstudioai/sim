import type { SapConcurProxyResponse, UploadReceiptImageParams } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const SAP_CONCUR_UPLOAD_URL = '/api/tools/sap_concur/upload'

export const uploadReceiptImageTool: ToolConfig<UploadReceiptImageParams, SapConcurProxyResponse> =
  {
    id: 'sap_concur_upload_receipt_image',
    name: 'SAP Concur Upload Receipt Image',
    description:
      'Upload an image-only receipt (POST /receipts/v4/users/{userId}/image-only-receipts).',
    version: '1.0.0',
    params: {
      datacenter: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Concur datacenter base URL (defaults to us.api.concursolutions.com)',
      },
      grantType: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'OAuth grant type: client_credentials (default) or password',
      },
      clientId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Concur OAuth client ID',
      },
      clientSecret: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Concur OAuth client secret',
      },
      username: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Username (only for password grant)',
      },
      password: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Password (only for password grant)',
      },
      companyUuid: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Company UUID for multi-company access tokens',
      },
      userId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Concur user UUID who owns the receipt',
      },
      receipt: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Receipt image file (UserFile reference). Supported formats: PDF, PNG, JPEG, GIF, TIFF',
      },
      forwardId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Optional client-supplied dedup id (max 40 chars). Sent as the concur-forwardid header.',
      },
    },
    request: {
      url: SAP_CONCUR_UPLOAD_URL,
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => {
        const userId = trimRequired(params.userId, 'userId')
        return {
          ...baseProxyBody(params),
          operation: 'upload_receipt_image',
          userId,
          receipt: params.receipt,
          forwardId: params.forwardId,
        }
      },
    },
    transformResponse: transformSapConcurProxyResponse,
    outputs: {
      status: { type: 'number', description: 'HTTP status code returned by Concur' },
      data: {
        type: 'json',
        description:
          'Image-only receipt upload response (HTTP 202 Accepted; Location and Link response headers exposed in body)',
        properties: {
          location: {
            type: 'string',
            description:
              'Location header URL for the new receipt image (e.g. /receipts/v4/images/{receiptId})',
            optional: true,
          },
          link: {
            type: 'string',
            description: 'Link header URL pointing to /receipts/v4/status/{receiptId}',
            optional: true,
          },
        },
      },
    },
  }
