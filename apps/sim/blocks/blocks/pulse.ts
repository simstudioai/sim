import { PulseIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type SubBlockType } from '@/blocks/types'
import type { PulseParserOutput } from '@/tools/pulse/types'

export const PulseBlock: BlockConfig<PulseParserOutput> = {
  type: 'pulse',
  name: 'Pulse',
  description: 'Extract text from documents using Pulse OCR',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Pulse into the workflow. Extract text from PDF documents, images, and Office files via URL or upload.',
  docsLink: 'https://docs.sim.ai/tools/pulse',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: PulseIcon,
  subBlocks: [
    {
      id: 'inputMethod',
      title: 'Select Input Method',
      type: 'dropdown' as SubBlockType,
      options: [
        { id: 'url', label: 'Document URL' },
        { id: 'upload', label: 'Upload Document' },
      ],
    },
    {
      id: 'filePath',
      title: 'Document URL',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter full URL to a document (https://example.com/document.pdf)',
      condition: {
        field: 'inputMethod',
        value: 'url',
      },
    },
    {
      id: 'fileUpload',
      title: 'Upload Document',
      type: 'file-upload' as SubBlockType,
      acceptedTypes: 'application/pdf,image/*,.docx,.pptx,.xlsx',
      condition: {
        field: 'inputMethod',
        value: 'upload',
      },
      maxSize: 50,
    },
    {
      id: 'pages',
      title: 'Specific Pages',
      type: 'short-input',
      placeholder: 'e.g. 1-3,5 (leave empty for all pages)',
    },
    {
      id: 'chunking',
      title: 'Chunking Strategy',
      type: 'short-input',
      placeholder: 'e.g. semantic,header,page,recursive',
    },
    {
      id: 'chunkSize',
      title: 'Chunk Size',
      type: 'short-input',
      placeholder: 'Max characters per chunk',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter your Pulse API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['pulse_parser'],
    config: {
      tool: () => 'pulse_parser',
      params: (params) => {
        if (!params || !params.apiKey || params.apiKey.trim() === '') {
          throw new Error('Pulse API key is required')
        }

        const parameters: Record<string, unknown> = {
          apiKey: params.apiKey.trim(),
        }

        const inputMethod = params.inputMethod || 'url'
        if (inputMethod === 'url') {
          if (!params.filePath || params.filePath.trim() === '') {
            throw new Error('Document URL is required')
          }
          parameters.filePath = params.filePath.trim()
        } else if (inputMethod === 'upload') {
          if (!params.fileUpload) {
            throw new Error('Please upload a document')
          }
          parameters.fileUpload = params.fileUpload
        }

        if (params.pages && params.pages.trim() !== '') {
          parameters.pages = params.pages.trim()
        }

        if (params.chunking && params.chunking.trim() !== '') {
          parameters.chunking = params.chunking.trim()
        }

        if (params.chunkSize && params.chunkSize.trim() !== '') {
          const size = Number.parseInt(params.chunkSize.trim(), 10)
          if (!Number.isNaN(size) && size > 0) {
            parameters.chunkSize = size
          }
        }

        return parameters
      },
    },
  },
  inputs: {
    inputMethod: { type: 'string', description: 'Input method selection' },
    filePath: { type: 'string', description: 'Document URL' },
    fileUpload: { type: 'json', description: 'Uploaded document file' },
    apiKey: { type: 'string', description: 'Pulse API key' },
    pages: { type: 'string', description: 'Page range selection' },
    chunking: {
      type: 'string',
      description: 'Chunking strategies (semantic, header, page, recursive)',
    },
    chunkSize: { type: 'string', description: 'Maximum characters per chunk' },
  },
  outputs: {
    markdown: { type: 'string', description: 'Extracted content in markdown format' },
    page_count: { type: 'number', description: 'Number of pages in the document' },
    job_id: { type: 'string', description: 'Unique job identifier' },
    'plan-info': { type: 'json', description: 'Plan usage information' },
    bounding_boxes: { type: 'json', description: 'Bounding box layout information' },
    extraction_url: { type: 'string', description: 'URL for extraction results (large documents)' },
    html: { type: 'string', description: 'HTML content if requested' },
    structured_output: { type: 'json', description: 'Structured output if schema was provided' },
    chunks: { type: 'json', description: 'Chunked content if chunking was enabled' },
    figures: { type: 'json', description: 'Extracted figures if figure extraction was enabled' },
  },
}
