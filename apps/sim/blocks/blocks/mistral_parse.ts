import { MistralIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type SubBlockType } from '@/blocks/types'
import { createVersionedToolSelector, normalizeFileInput } from '@/blocks/utils'
import type { MistralParserOutput } from '@/tools/mistral/types'

export const MistralParseBlock: BlockConfig<MistralParserOutput> = {
  type: 'mistral_parse',
  name: 'Mistral Parser (Legacy)',
  description: 'Extract text from PDF documents',
  hideFromToolbar: true,
  authMode: AuthMode.ApiKey,
  longDescription: `Integrate Mistral Parse into the workflow. Can extract text from uploaded PDF documents, or from a URL.`,
  docsLink: 'https://docs.sim.ai/tools/mistral_parse',
  category: 'tools',
  bgColor: '#000000',
  icon: MistralIcon,
  subBlocks: [
    {
      id: 'inputMethod',
      title: 'Select Input Method',
      type: 'dropdown' as SubBlockType,
      options: [
        { id: 'url', label: 'PDF Document URL' },
        { id: 'upload', label: 'Upload PDF Document' },
      ],
    },
    {
      id: 'filePath',
      title: 'PDF Document URL',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter full URL to a PDF document (https://example.com/document.pdf)',
      condition: {
        field: 'inputMethod',
        value: 'url',
      },
    },
    {
      id: 'fileUpload',
      title: 'Upload PDF',
      type: 'file-upload' as SubBlockType,
      acceptedTypes: 'application/pdf',
      condition: {
        field: 'inputMethod',
        value: 'upload',
      },
      maxSize: 50,
    },
    {
      id: 'resultType',
      title: 'Output Format',
      type: 'dropdown',
      options: [
        { id: 'markdown', label: 'Markdown (Formatted)' },
        { id: 'text', label: 'Plain Text' },
        { id: 'json', label: 'JSON (Raw)' },
      ],
    },
    {
      id: 'pages',
      title: 'Specific Pages',
      type: 'short-input',
      placeholder: 'e.g. 0,1,2 (leave empty for all pages)',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter your Mistral API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['mistral_parser'],
    config: {
      tool: () => 'mistral_parser',
      params: (params) => {
        if (!params || !params.apiKey || params.apiKey.trim() === '') {
          throw new Error('Mistral API key is required')
        }

        const parameters: Record<string, unknown> = {
          apiKey: params.apiKey.trim(),
          resultType: params.resultType || 'markdown',
        }

        const inputMethod = params.inputMethod || 'url'
        if (inputMethod === 'url') {
          if (!params.filePath || params.filePath.trim() === '') {
            throw new Error('PDF Document URL is required')
          }
          parameters.filePath = params.filePath.trim()
        } else if (inputMethod === 'upload') {
          if (!params.fileUpload) {
            throw new Error('Please upload a PDF document')
          }
          parameters.file = params.fileUpload
        }

        let pagesArray: number[] | undefined
        if (params.pages && params.pages.trim() !== '') {
          try {
            pagesArray = params.pages
              .split(',')
              .map((p: string) => p.trim())
              .filter((p: string) => p.length > 0)
              .map((p: string) => {
                const num = Number.parseInt(p, 10)
                if (Number.isNaN(num) || num < 0) {
                  throw new Error(`Invalid page number: ${p}`)
                }
                return num
              })

            if (pagesArray && pagesArray.length === 0) {
              pagesArray = undefined
            }
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            throw new Error(`Page number format error: ${errorMessage}`)
          }
        }

        if (pagesArray && pagesArray.length > 0) {
          parameters.pages = pagesArray
        }

        return parameters
      },
    },
  },
  inputs: {
    inputMethod: { type: 'string', description: 'Input method selection' },
    filePath: { type: 'string', description: 'PDF document URL' },
    fileUpload: { type: 'json', description: 'Uploaded PDF file' },
    apiKey: { type: 'string', description: 'Mistral API key' },
    resultType: { type: 'string', description: 'Output format type' },
    pages: { type: 'string', description: 'Page selection' },
  },
  outputs: {
    content: { type: 'string', description: 'Extracted content' },
    metadata: { type: 'json', description: 'Processing metadata' },
  },
}

/**
 * V2 Block - Restored from main branch for backwards compatibility
 * Hidden from toolbar, uses filePath subblock ID for advanced mode
 */
export const MistralParseV2Block: BlockConfig<MistralParserOutput> = {
  ...MistralParseBlock,
  type: 'mistral_parse_v2',
  name: 'Mistral Parser',
  description: 'Extract text from PDF documents',
  hideFromToolbar: true,
  subBlocks: [
    {
      id: 'fileUpload',
      title: 'PDF Document',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'document',
      acceptedTypes: 'application/pdf',
      placeholder: 'Upload a PDF document',
      mode: 'basic',
      maxSize: 50,
    },
    {
      id: 'filePath',
      title: 'PDF Document',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'document',
      placeholder: 'Document URL',
      mode: 'advanced',
    },
    {
      id: 'resultType',
      title: 'Output Format',
      type: 'dropdown',
      options: [
        { id: 'markdown', label: 'Markdown' },
        { id: 'text', label: 'Plain Text' },
        { id: 'json', label: 'JSON' },
      ],
    },
    {
      id: 'pages',
      title: 'Specific Pages',
      type: 'short-input',
      placeholder: 'e.g. 0,1,2 (leave empty for all pages)',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter your Mistral API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['mistral_parser_v2'],
    config: {
      tool: createVersionedToolSelector({
        baseToolSelector: () => 'mistral_parser',
        suffix: '_v2',
        fallbackToolId: 'mistral_parser_v2',
      }),
      params: (params) => {
        if (!params || !params.apiKey || params.apiKey.trim() === '') {
          throw new Error('Mistral API key is required')
        }

        const parameters: Record<string, unknown> = {
          apiKey: params.apiKey.trim(),
          resultType: params.resultType || 'markdown',
        }

        // Use canonical document param directly
        const documentInput = params.document
        if (!documentInput) {
          throw new Error('PDF document is required')
        }
        // Smart handling: object → fileUpload param, string → filePath param
        if (typeof documentInput === 'object') {
          parameters.fileUpload = documentInput
        } else if (typeof documentInput === 'string') {
          parameters.filePath = documentInput.trim()
        }

        let pagesArray: number[] | undefined
        if (params.pages && params.pages.trim() !== '') {
          try {
            pagesArray = params.pages
              .split(',')
              .map((p: string) => p.trim())
              .filter((p: string) => p.length > 0)
              .map((p: string) => {
                const num = Number.parseInt(p, 10)
                if (Number.isNaN(num) || num < 0) {
                  throw new Error(`Invalid page number: ${p}`)
                }
                return num
              })

            if (pagesArray && pagesArray.length === 0) {
              pagesArray = undefined
            }
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            throw new Error(`Page number format error: ${errorMessage}`)
          }
        }

        if (pagesArray && pagesArray.length > 0) {
          parameters.pages = pagesArray
        }

        return parameters
      },
    },
  },
  inputs: {
    document: { type: 'json', description: 'Document input (file upload or URL reference)' },
    apiKey: { type: 'string', description: 'Mistral API key' },
    resultType: { type: 'string', description: 'Output format type' },
    pages: { type: 'string', description: 'Page selection' },
  },
  outputs: {
    pages: { type: 'array', description: 'Array of page objects from Mistral OCR' },
    model: { type: 'string', description: 'Mistral OCR model identifier' },
    usage_info: { type: 'json', description: 'Usage statistics from the API' },
    document_annotation: { type: 'string', description: 'Structured annotation data' },
  },
}

/**
 * V3 Block - New file handling pattern with UserFile normalization
 * Uses fileReference subblock ID with canonicalParamId for proper file handling
 */
export const MistralParseV3Block: BlockConfig<MistralParserOutput> = {
  ...MistralParseBlock,
  type: 'mistral_parse_v3',
  name: 'Mistral Parser',
  description: 'Extract text from PDF documents',
  hideFromToolbar: false,
  subBlocks: [
    {
      id: 'fileUpload',
      title: 'PDF Document',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'document',
      acceptedTypes: 'application/pdf',
      placeholder: 'Upload a PDF document',
      mode: 'basic',
      maxSize: 50,
      required: true,
    },
    {
      id: 'fileReference',
      title: 'File Reference',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'document',
      placeholder: 'File reference from previous block',
      mode: 'advanced',
      required: true,
    },
    {
      id: 'resultType',
      title: 'Output Format',
      type: 'dropdown',
      options: [
        { id: 'markdown', label: 'Markdown' },
        { id: 'text', label: 'Plain Text' },
        { id: 'json', label: 'JSON' },
      ],
    },
    {
      id: 'pages',
      title: 'Specific Pages',
      type: 'short-input',
      placeholder: 'e.g. 0,1,2 (leave empty for all pages)',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter your Mistral API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['mistral_parser_v3'],
    config: {
      tool: () => 'mistral_parser_v3',
      params: (params) => {
        if (!params || !params.apiKey || params.apiKey.trim() === '') {
          throw new Error('Mistral API key is required')
        }

        const parameters: Record<string, unknown> = {
          apiKey: params.apiKey.trim(),
          resultType: params.resultType || 'markdown',
        }

        // V3 pattern: use canonical document param directly
        const documentInput = normalizeFileInput(params.document, { single: true })
        if (!documentInput) {
          throw new Error('PDF document is required')
        }
        parameters.file = documentInput

        let pagesArray: number[] | undefined
        if (params.pages && params.pages.trim() !== '') {
          try {
            pagesArray = params.pages
              .split(',')
              .map((p: string) => p.trim())
              .filter((p: string) => p.length > 0)
              .map((p: string) => {
                const num = Number.parseInt(p, 10)
                if (Number.isNaN(num) || num < 0) {
                  throw new Error(`Invalid page number: ${p}`)
                }
                return num
              })

            if (pagesArray && pagesArray.length === 0) {
              pagesArray = undefined
            }
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            throw new Error(`Page number format error: ${errorMessage}`)
          }
        }

        if (pagesArray && pagesArray.length > 0) {
          parameters.pages = pagesArray
        }

        return parameters
      },
    },
  },
  inputs: {
    document: { type: 'json', description: 'Document input (file upload or file reference)' },
    apiKey: { type: 'string', description: 'Mistral API key' },
    resultType: { type: 'string', description: 'Output format type' },
    pages: { type: 'string', description: 'Page selection' },
  },
  outputs: {
    pages: { type: 'array', description: 'Array of page objects from Mistral OCR' },
    model: { type: 'string', description: 'Mistral OCR model identifier' },
    usage_info: { type: 'json', description: 'Usage statistics from the API' },
    document_annotation: { type: 'string', description: 'Structured annotation data' },
  },
}
