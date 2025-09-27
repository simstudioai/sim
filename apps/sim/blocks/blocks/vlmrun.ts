import { VlmRunIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { VlmRunResponse } from '@/tools/vlmrun/types'

export const VlmRunInvoiceParserBlock: BlockConfig<VlmRunResponse> = {
  type: 'vlmrun_invoice_parser',
  name: 'VLM Run Invoice Parser',
  description: 'Upload and parse an invoice to extract structured JSON',
  longDescription:
    'Uploads an invoice file (PDF/image) and uses VLM Run to extract data like invoice number, total, due date, etc.',
  category: 'tools',
  bgColor: '#4A90E2',
  icon: VlmRunIcon,

  subBlocks: [
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Vlm Run API Key',
      password: true,
      required: true,
    },
    {
      id: 'filePath',
      title: 'Invoice File Path',
      type: 'short-input',
      layout: 'full',
      placeholder: '/path/to/invoice.pdf',
      required: true,
    },
  ],

  tools: {
    access: ['vlmrun_parse_invoice'],
    config: {
      tool: () => 'vlmrun_parse_invoice',
    },
  },

  inputs: {
    apiKey: { type: 'string', description: 'Vlm Run API Key' },
    filePath: { type: 'string', description: 'Path to the invoice file' },
  },

  outputs: {
    data: {
      type: 'any',
      description: 'Structured invoice JSON (e.g., { invoice_number, total, due_date })',
    },
  },
}
