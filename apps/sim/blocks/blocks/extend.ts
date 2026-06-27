import { ExtendBlockDisplay, ExtendV2BlockDisplay } from '@/blocks/blocks/extend.display'
import { AuthMode, type BlockConfig, type SubBlockType } from '@/blocks/types'
import { createVersionedToolSelector, normalizeFileInput } from '@/blocks/utils'
import type { ExtendParserOutput } from '@/tools/extend/types'

export const ExtendBlock: BlockConfig<ExtendParserOutput> = {
  ...ExtendBlockDisplay,
  authMode: AuthMode.ApiKey,
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

const extendV2Inputs = {
  file: { type: 'json' as const, description: 'Document (file upload or file reference)' },
  apiKey: ExtendBlock.inputs?.apiKey,
  outputFormat: ExtendBlock.inputs?.outputFormat,
  chunking: ExtendBlock.inputs?.chunking,
  engine: ExtendBlock.inputs?.engine,
}
const extendV2SubBlocks = (ExtendBlock.subBlocks || []).flatMap((subBlock) => {
  if (subBlock.id === 'filePath') {
    return []
  }
  if (subBlock.id === 'fileUpload') {
    return [
      { ...subBlock, canonicalParamId: 'file' },
      {
        id: 'fileReference',
        title: 'Document',
        type: 'short-input' as SubBlockType,
        canonicalParamId: 'file',
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
  ...ExtendV2BlockDisplay,
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

        const documentInput = normalizeFileInput(params.file, { single: true })
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
