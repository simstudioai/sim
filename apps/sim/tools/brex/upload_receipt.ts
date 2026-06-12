import type { BrexUploadReceiptParams, BrexUploadReceiptResponse } from '@/tools/brex/types'
import type { ToolConfig } from '@/tools/types'

export const brexUploadReceiptTool: ToolConfig<BrexUploadReceiptParams, BrexUploadReceiptResponse> =
  {
    id: 'brex_upload_receipt',
    name: 'Brex Upload Receipt',
    description: 'Upload a receipt file and attach it to a specific Brex card expense',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
      },
      expenseId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the card expense to attach the receipt to',
      },
      file: {
        type: 'file',
        required: true,
        visibility: 'user-or-llm',
        description: 'Receipt file to upload (max 50 MB)',
      },
      receiptName: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Receipt file name including extension (defaults to the uploaded file name)',
      },
    },

    request: {
      url: '/api/tools/brex/upload-receipt',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        apiKey: params.apiKey,
        expenseId: params.expenseId,
        file: params.file,
        receiptName: params.receiptName,
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      if (!data.success) {
        throw new Error(data.error || 'Failed to upload receipt')
      }
      return {
        success: true,
        output: data.output,
      }
    },

    outputs: {
      receiptId: { type: 'string', description: 'Unique identifier of the receipt upload' },
      receiptName: { type: 'string', description: 'Name the receipt was uploaded with' },
      expenseId: {
        type: 'string',
        description: 'ID of the expense the receipt was attached to',
        optional: true,
      },
    },
  }
