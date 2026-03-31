import { ExtendIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, IntegrationType, type SubBlockType } from '@/blocks/types'
import { createVersionedToolSelector, normalizeFileInput } from '@/blocks/utils'
import type { ExtendParserOutput } from '@/tools/extend/types'

export const ExtendBlock: BlockConfig<ExtendParserOutput> = {
  type: 'extend',
  name: 'Extend',
  description: 'Parse and extract content from documents',
  hideFromToolbar: true,
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Extend AI into the workflow. Parse and extract structured content from documents including PDFs, images, and Office files.',
  docsLink: 'https://docs.sim.ai/tools/extend',
  category: 'tools',
  integrationType: IntegrationType.AI,
  tags: ['document-processing', 'ocr'],
  bgColor: '#000000',
  icon: ExtendIcon,
  subBlocks: [
    {
      id: 'fileUpload',
      title: 'Document',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'document',
      acceptedTypes:
        'application/pdf,image/jpeg,image/png,image/tiff,image/gif,image/bmp,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      placeholder: 'Upload a document',
      mode: 'basic',
      maxSize: 50,
      required: true,
    },
    {
      id: 'filePath',
      title: 'Document',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'document',
      placeholder: 'Document URL',
      mode: 'advanced',
      required: true,
    },
    {
      id: 'outputFormat',
      title: 'Output Format',
      type: 'dropdown',
      options: [
        { id: 'markdown', label: 'Markdown' },
        { id: 'spatial', label: 'Spatial' },
      ],
    },
    {
      id: 'chunking',
      title: 'Chunking Strategy',
      type: 'dropdown',
      options: [
        { id: 'page', label: 'Page' },
        { id: 'document', label: 'Document' },
        { id: 'section', label: 'Section' },
      ],
    },
    {
      id: 'engine',
      title: 'Engine',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { id: 'parse_performance', label: 'Performance' },
        { id: 'parse_light', label: 'Light' },
      ],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter your Extend API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['extend_parser'],
    config: {
      tool: () => 'extend_parser',
      params: (params) => {
        const parameters: Record<string, unknown> = {
          apiKey: params.apiKey.trim(),
        }

        const documentInput = params.document

        if (typeof documentInput === 'object') {
          parameters.file = documentInput
        } else if (typeof documentInput === 'string') {
          parameters.filePath = documentInput.trim()
        }

        if (params.outputFormat) {
          parameters.outputFormat = params.outputFormat
        }

        if (params.chunking) {
          parameters.chunking = params.chunking
        }

        if (params.engine) {
          parameters.engine = params.engine
        }

        return parameters
      },
    },
  },
  inputs: {
    document: {
      type: 'json',
      description: 'Document input (canonical param for file upload or URL)',
    },
    apiKey: { type: 'string', description: 'Extend API key' },
    outputFormat: { type: 'string', description: 'Output format (markdown or spatial)' },
    chunking: { type: 'string', description: 'Chunking strategy' },
    engine: { type: 'string', description: 'Parsing engine' },
  },
  outputs: {
    id: { type: 'string', description: 'Unique identifier for the parser run' },
    status: { type: 'string', description: 'Processing status' },
    chunks: { type: 'json', description: 'Parsed document content chunks' },
    blocks: { type: 'json', description: 'Block-level document elements' },
    pageCount: { type: 'number', description: 'Number of pages processed' },
    creditsUsed: { type: 'number', description: 'API credits consumed' },
  },
}

const extendV2Inputs = ExtendBlock.inputs
const extendV2SubBlocks = (ExtendBlock.subBlocks || []).flatMap((subBlock) => {
  if (subBlock.id === 'filePath') {
    return []
  }
  if (subBlock.id === 'fileUpload') {
    return [
      subBlock,
      {
        id: 'fileReference',
        title: 'Document',
        type: 'short-input' as SubBlockType,
        canonicalParamId: 'document',
        placeholder: 'Connect a file output from another block',
        mode: 'advanced' as const,
        required: true,
      },
    ]
  }
  return [subBlock]
})

export const ExtendV2Block: BlockConfig<ExtendParserOutput> = {
  ...ExtendBlock,
  type: 'extend_v2',
  name: 'Extend',
  hideFromToolbar: false,
  longDescription:
    'Integrate Extend AI into the workflow. Parse and extract structured content from documents or file references.',
  subBlocks: extendV2SubBlocks,
  tools: {
    access: ['extend_parser_v2'],
    config: {
      tool: createVersionedToolSelector({
        baseToolSelector: () => 'extend_parser',
        suffix: '_v2',
        fallbackToolId: 'extend_parser_v2',
      }),
      params: (params) => {
        const parameters: Record<string, unknown> = {
          apiKey: params.apiKey.trim(),
        }

        const documentInput = normalizeFileInput(params.document, { single: true })
        if (!documentInput) {
          throw new Error('Document file is required')
        }
        parameters.file = documentInput

        if (params.outputFormat) {
          parameters.outputFormat = params.outputFormat
        }

        if (params.chunking) {
          parameters.chunking = params.chunking
        }

        if (params.engine) {
          parameters.engine = params.engine
        }

        return parameters
      },
    },
  },
  inputs: extendV2Inputs,
}
