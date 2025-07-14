import { MistralIcon } from '@/components/icons'
import { isProd } from '@/lib/environment'
import type { MistralParserOutput } from '@/tools/mistral/types'
import type { BlockConfig, SubBlockConfig, SubBlockLayout, SubBlockType } from '../types'

const shouldEnableFileUpload = isProd

const inputMethodBlock: SubBlockConfig = {
  id: 'inputMethod',
  title: 'Select Input Method',
  type: 'dropdown' as SubBlockType,
  layout: 'full' as SubBlockLayout,
  options: [
    { id: 'url', label: 'PDF Document URL' },
    { id: 'upload', label: 'Upload PDF Document' },
  ],
}

const fileUploadBlock: SubBlockConfig = {
  id: 'fileUpload',
  title: 'Upload PDF',
  type: 'file-upload' as SubBlockType,
  layout: 'full' as SubBlockLayout,
  acceptedTypes: 'application/pdf',
  condition: {
    field: 'inputMethod',
    value: 'upload',
  },
  maxSize: 50, // 50MB max via direct upload
}

export const MistralParseBlock: BlockConfig<MistralParserOutput> = {
  type: 'mistral_parse',
  name: 'Mistral Parser',
  description: 'Extract text from PDF documents',
  longDescription: `Extract text and structure from PDF documents using Mistral's OCR API.${
    shouldEnableFileUpload
      ? ' Either enter a URL to a PDF document or upload a PDF file directly.'
      : ' Enter a URL to a PDF document (.pdf extension required).'
  } Configure processing options and get the content in your preferred format. For URLs, they must be publicly accessible and point to a valid PDF file. Note: Google Drive, Dropbox, and other cloud storage links are not supported; use a direct download URL from a web server instead.`,
  docsLink: 'https://docs.simstudio.ai/tools/mistral_parse',
  category: 'tools',
  bgColor: '#000000',
  icon: MistralIcon,
  subBlocks: [
    // Show input method selection only if file upload is available
    ...(shouldEnableFileUpload ? [inputMethodBlock] : []),

    // URL input - always shown, but conditional on inputMethod in production
    {
      id: 'filePath',
      title: 'PDF Document URL',
      type: 'short-input' as SubBlockType,
      layout: 'full' as SubBlockLayout,
      placeholder: 'Enter full URL to a PDF document (https://example.com/document.pdf)',
      ...(shouldEnableFileUpload
        ? {
            condition: {
              field: 'inputMethod',
              value: 'url',
            },
          }
        : {}),
    },

    // File upload option - only shown in production environments
    ...(shouldEnableFileUpload ? [fileUploadBlock] : []),

    {
      id: 'resultType',
      title: 'Output Format',
      type: 'dropdown',
      layout: 'full',
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
      layout: 'full',
      placeholder: 'e.g. 0,1,2 (leave empty for all pages)',
    },
    /* 
     * Image-related parameters - temporarily disabled
     * Uncomment if PDF image extraction is needed
     *
    {
      id: 'includeImageBase64',
      title: 'Include PDF Images',
      type: 'switch',
      layout: 'half',
    },
    {
      id: 'imageLimit',
      title: 'Max Images',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Maximum number of images to extract',
    },
    {
      id: 'imageMinSize',
      title: 'Min Image Size (px)',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Min width/height in pixels',
    },
    */
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input' as SubBlockType,
      layout: 'full' as SubBlockLayout,
      placeholder: 'Enter your Mistral API key',
      password: true,
    },
  ],
  tools: {
    access: ['mistral_parser'],
    config: {
      tool: () => 'mistral_parser',
      params: (params) => {
        // Basic validation
        if (!params || !params.apiKey || params.apiKey.trim() === '') {
          throw new Error('Mistral API key is required')
        }

        // Build parameters object - file processing is now handled at the tool level
        const parameters: any = {
          apiKey: params.apiKey.trim(),
          resultType: params.resultType || 'markdown',
        }

        // Set filePath or fileUpload based on input method (or directly use filePath if no method selector)
        if (shouldEnableFileUpload) {
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
            // Pass the entire fileUpload object to the tool
            parameters.fileUpload = params.fileUpload
          }
        } else {
          // In local development, only URL input is available
          if (!params.filePath || params.filePath.trim() === '') {
            throw new Error('PDF Document URL is required')
          }
          parameters.filePath = params.filePath.trim()
        }

        // Convert pages input from string to array of numbers if provided
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
          } catch (error: any) {
            throw new Error(`Page number format error: ${error.message}`)
          }
        }

        // Add optional parameters
        if (pagesArray && pagesArray.length > 0) {
          parameters.pages = pagesArray
        }

        return parameters
      },
    },
  },
  inputs: {
    inputMethod: { type: 'string', required: false },
    filePath: { type: 'string', required: !shouldEnableFileUpload },
    fileUpload: { type: 'json', required: false },
    apiKey: { type: 'string', required: true },
    resultType: { type: 'string', required: false },
    pages: { type: 'string', required: false },
    // Image-related inputs - temporarily disabled
    // includeImageBase64: { type: 'boolean', required: false },
    // imageLimit: { type: 'string', required: false },
    // imageMinSize: { type: 'string', required: false },
  },
  outputs: {
    content: 'string',
    metadata: 'json',
  },
}
