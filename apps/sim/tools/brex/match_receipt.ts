import type { BrexMatchReceiptParams, BrexUploadReceiptResponse } from '@/tools/brex/types'
import type { ToolConfig } from '@/tools/types'

export const brexMatchReceiptTool: ToolConfig<BrexMatchReceiptParams, BrexUploadReceiptResponse> = {
  id: 'brex_match_receipt',
  name: 'Brex Match Receipt',
  description: 'Upload a receipt file and let Brex automatically match it with existing expenses',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
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
      file: params.file,
      receiptName: params.receiptName,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to match receipt')
    }
    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    receiptId: { type: 'string', description: 'Unique identifier of the receipt match request' },
    receiptName: { type: 'string', description: 'Name the receipt was uploaded with' },
    expenseId: {
      type: 'string',
      description: 'Always null for receipt match (Brex matches the receipt asynchronously)',
      optional: true,
    },
  },
}
