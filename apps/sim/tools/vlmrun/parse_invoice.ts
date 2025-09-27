import { VlmRun } from 'vlmrun'
import type { ToolConfig } from '@/tools/types'
import type { HttpMethod, VlmRunParams, VlmRunResponse } from './types'

export const parseInvoiceTool: ToolConfig<VlmRunParams, VlmRunResponse> = {
  id: 'vlmrun_parse_invoice',
  name: 'Parse Invoice with VLM Run',
  description: 'Uploads an invoice file and extracts structured JSON using VLM Run',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'VLM Run API Key',
    },
    filePath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Path to the invoice file (PDF or image) or URL',
    },
  },
  request: {
    url: '',
    method: 'POST' as HttpMethod,
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: () => ({}),
  },
  //  request: {
  //   url: (params: VlmRunParams) =>
  //     params.filePath.startsWith('http')
  //       ? 'https://api.vlmrun.com/document/generate' // <-- real API endpoint
  //       : 'https://api.vlmrun.com/v1/files',
  //   method: () => 'POST' as HttpMethod,
  //   headers: (params: VlmRunParams) => ({
  //     Authorization: `Bearer ${params.apiKey}`,
  //     'Content-Type': 'application/json',
  //   }),
  //   body: (params: VlmRunParams) => ({
  //     filePath: params.filePath,
  //   }),
  // },

  transformResponse: async (
    _response: Response,
    params?: VlmRunParams
  ): Promise<VlmRunResponse> => {
    if (!params) {
      return {
        data: null,
        success: false,
        output: {},
        error: 'Missing parameters',
      }
    }

    const client = new VlmRun({ apiKey: params.apiKey })

    try {
      let parseResponse
      if (params.filePath.startsWith('http://') || params.filePath.startsWith('https://')) {
        parseResponse = await client.document.generate({
          url: params.filePath,
          model: 'vlm-1',
          domain: 'document.invoice',
        })
      } else {
        const uploadResponse = await client.files.upload({
          filePath: params.filePath,
        })
        parseResponse = await client.document.generate({
          fileId: uploadResponse.id,
          model: 'vlm-1',
          domain: 'document.invoice',
        })
      }

      if (parseResponse.status !== 'completed') {
        throw new Error(`Parsing failed: status ${parseResponse.status}`)
      }

      return {
        data: parseResponse.response,
        success: true,
        output: parseResponse.response,
      }
    } catch (error) {
      return {
        data: null,
        success: false,
        output: {},
        error: `Error processing invoice: ${(error as Error).message}`,
      }
    }
  },
}
