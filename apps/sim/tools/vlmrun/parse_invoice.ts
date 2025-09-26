import { ToolConfig } from './types';
import { VlmRunParams, VlmRunResponse,HttpMethod } from './types';
import { VlmRun } from 'vlmrun';

export const parseInvoiceTool: ToolConfig<VlmRunParams, VlmRunResponse> = {
  id: 'vlmrun_parse_invoice',
  name: 'Parse Invoice with VLM Run',
  description: 'Uploads an invoice file and extracts structured JSON using VLM Run',
  version: '1.0.0',
  provider: 'vlmrun',

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
    url: (params: VlmRunParams) =>
     params.filePath.startsWith('http://') || params.filePath.startsWith('https://') ? 'https://api.vlmrun.com/document/generate' : 'https://api.vlmrun.com/v1/files',

    method: (params: VlmRunParams) => (params.filePath.startsWith('http://') || params.filePath.startsWith('https://') ? 'POST' : 'POST') as HttpMethod,
    headers: (params: VlmRunParams) => ({
      'Authorization': `Bearer ${params.apiKey}`,
      
    }),
    body: (params: VlmRunParams) => ({
      filePath: params.filePath, // Placeholder; SDK handles actual file upload
    }),
  },

  execute: async (params: VlmRunParams): Promise<VlmRunResponse> => {
    const client = new VlmRun({ apiKey: params.apiKey });

    try {
      let parseResponse: any;
      if (params.filePath.startsWith('http://') || params.filePath.startsWith('https://')) {
        parseResponse = await client.document.generate({
          url: params.filePath,
          model: 'vlm-1',
          domain: 'document.invoice',
          batch: false,
        });
      } else {
        const uploadResponse = await client.files.upload({ filePath: params.filePath });
        const fileId = uploadResponse.id;
        parseResponse = await client.document.generate({
          fileId,
          model: 'vlm-1',
          domain: 'document.invoice',
          batch: false,
        });
      }

      if (parseResponse.status !== 'completed') {
        throw new Error(`Parsing failed: status ${parseResponse.status}. Check file/URL or retry.`);
      }

      return {
        data: parseResponse.response,
        success: true,
        output: parseResponse.response, 
      };
    } catch (error) {
      return {
        data: null,
        success: false,
        output: {},
        error: `Error processing invoice: ${(error as Error).message}`,
      };
    }
  },
};