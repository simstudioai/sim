import { ToolConfig } from './types'
import { VlmRunParams, VlmRunResponse } from './types'
import { VlmRun } from 'vlmrun'

export const parseInvoiceTool: ToolConfig<VlmRunParams, VlmRunResponse> = {
  id: 'vlmrun_parse_invoice',
  name: 'Parse Invoice with VLM Run',
  description: 'Uploads an invoice file and extracts structured JSON using VLM Run',
  version: '1.0.0',
  provider: 'vlmrun',

  request: {
  url: () => 'https://api.vlmrun.com/files/upload',
  method: 'POST' as const, 
  headers: (params: VlmRunParams) => ({  
    'Authorization': `Bearer ${params.apiKey}`,
    'Content-Type': 'multipart/form-data',
  }),
  body: (params: VlmRunParams) => ({     
    filePath: params.filePath,
  }),
},
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
      description: 'Path to the invoice file (PDF or image)',
    },
  },

  execute: async (params: VlmRunParams): Promise<VlmRunResponse> => {
  const client = new VlmRun({ apiKey: params.apiKey })
  console.log(`[DEBUG] Starting execution with filePath/URL: ${params.filePath}`)

  let fileId: string | undefined
  let parseResponse: any

  const isUrl = params.filePath.startsWith('http://') || params.filePath.startsWith('https://')
  console.log(`[DEBUG] Detected as URL: ${isUrl}`)

  try {
    if (isUrl) {
      console.log(`[DEBUG] Using URL for document generation: ${params.filePath}`)
      parseResponse = await client.document.generate({
        url: params.filePath,
        model: 'vlm-1',
        domain: 'document.invoice',
        batch: false,
      })
    } else {
      console.log(`[DEBUG] Uploading local file: ${params.filePath}`)
      const uploadResponse = await client.files.upload({ filePath: params.filePath })
      fileId = uploadResponse.id
      console.log(`[DEBUG] File uploaded, ID: ${fileId}`)
      console.log(`[DEBUG] Generating document from fileId: ${fileId}`)
      parseResponse = await client.document.generate({
        fileId,
        model: 'vlm-1',
        domain: 'document.invoice',
        batch: false,
      })
    }

    console.log(`[DEBUG] API response: ${JSON.stringify(parseResponse)}`)

    if (parseResponse.status !== 'completed') {
      console.error(`[ERROR] Parsing failed: status ${parseResponse.status}`)
      throw new Error(`Parsing failed: status ${parseResponse.status}. Check file/URL or retry.`)
    }

    return {
      success: true,
      data: parseResponse.response,
      output: parseResponse.response,
      error: undefined,
    }
  } catch (error) {
    console.error(`[ERROR] Execution failed: ${(error as Error).message}`)
    return {
      success: false,
      data: null,
      output: {},
      error: (error as Error).message,
    }
  }
},
}