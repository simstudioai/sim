import { ReductoIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type SubBlockType } from '@/blocks/types'
import type { ReductoParserOutput } from '@/tools/reducto/types'

export const ReductoBlock: BlockConfig<ReductoParserOutput> = {
  type: 'reducto',
  name: 'Reducto',
  description: 'Extract text from PDF documents',
  authMode: AuthMode.ApiKey,
  longDescription: `Integrate Reducto Parse into the workflow. Can extract text from uploaded PDF documents, or from a URL.`,
  docsLink: 'https://docs.sim.ai/tools/reducto',
  category: 'tools',
  bgColor: '#5c0c5c',
  icon: ReductoIcon,
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
      id: 'pages',
      title: 'Specific Pages',
      type: 'short-input',
      placeholder: 'e.g. 1,2,3 (1-indexed, leave empty for all)',
    },
    {
      id: 'tableOutputFormat',
      title: 'Table Format',
      type: 'dropdown',
      options: [
        { id: 'md', label: 'Markdown' },
        { id: 'html', label: 'HTML' },
      ],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter your Reducto API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['reducto_parser'],
    config: {
      tool: () => 'reducto_parser',
      params: (params) => {
        if (!params || !params.apiKey || params.apiKey.trim() === '') {
          throw new Error('Reducto API key is required')
        }

        const parameters: Record<string, unknown> = {
          apiKey: params.apiKey.trim(),
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
          parameters.fileUpload = params.fileUpload
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

        if (params.tableOutputFormat) {
          parameters.tableOutputFormat = params.tableOutputFormat
        }

        return parameters
      },
    },
  },
  inputs: {
    inputMethod: { type: 'string', description: 'Input method selection' },
    filePath: { type: 'string', description: 'PDF document URL' },
    fileUpload: { type: 'json', description: 'Uploaded PDF file' },
    apiKey: { type: 'string', description: 'Reducto API key' },
    pages: { type: 'string', description: 'Page selection' },
    tableOutputFormat: { type: 'string', description: 'Table output format' },
  },
  outputs: {
    job_id: { type: 'string', description: 'Unique identifier for the processing job' },
    duration: { type: 'number', description: 'Processing time in seconds' },
    usage: { type: 'json', description: 'Resource consumption data (num_pages, credits)' },
    result: { type: 'json', description: 'Parsed document content with chunks and blocks' },
    pdf_url: { type: 'string', description: 'Storage URL of converted PDF' },
    studio_link: { type: 'string', description: 'Link to Reducto studio interface' },
  },
}
