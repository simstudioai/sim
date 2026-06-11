import type { RampUploadReceiptParams, RampUploadReceiptResponse } from '@/tools/ramp/types'
import type { ToolConfig } from '@/tools/types'

export const rampUploadReceiptTool: ToolConfig<RampUploadReceiptParams, RampUploadReceiptResponse> =
  {
    id: 'ramp_upload_receipt',
    name: 'Ramp Upload Receipt',
    description:
      'Upload a receipt image to Ramp and optionally attach it to a transaction. When no transaction is provided, Ramp matches the receipt to the most relevant transaction automatically.',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'ramp',
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'OAuth access token for the Ramp API',
      },
      userId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the Ramp user to associate with the receipt',
      },
      transactionId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'ID of the transaction to attach the receipt to',
      },
      file: {
        type: 'file',
        required: true,
        visibility: 'user-or-llm',
        description: 'The receipt image or PDF to upload',
      },
    },

    request: {
      url: '/api/tools/ramp/upload-receipt',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        accessToken: params.accessToken,
        userId: params.userId,
        transactionId: params.transactionId,
        file: params.file,
      }),
    },

    transformResponse: async (response): Promise<RampUploadReceiptResponse> => {
      const data = await response.json()

      if (!response.ok || !data.success) {
        return {
          success: false,
          error: data.error || 'Failed to upload receipt to Ramp',
          output: {},
        }
      }

      return {
        success: true,
        output: data.output,
      }
    },

    outputs: {
      receiptId: {
        type: 'string',
        description: 'Unique identifier of the uploaded receipt',
      },
    },
  }
