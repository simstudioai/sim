import { DocumentIcon } from '@/components/icons'
import { isProd } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import type { FileParserOutput } from '@/tools/file/types'
import type { BlockConfig, SubBlockConfig, SubBlockLayout, SubBlockType } from '../types'

const logger = createLogger('FileBlock')

const shouldEnableURLInput = isProd

const inputMethodBlock: SubBlockConfig = {
  id: 'inputMethod',
  title: 'Select Input Method',
  type: 'dropdown' as SubBlockType,
  layout: 'full' as SubBlockLayout,
  options: [
    { id: 'url', label: 'File URL' },
    { id: 'upload', label: 'Upload Files' },
  ],
}

const fileUploadBlock: SubBlockConfig = {
  id: 'file',
  title: 'Upload Files',
  type: 'file-upload' as SubBlockType,
  layout: 'full' as SubBlockLayout,
  acceptedTypes: '.pdf,.csv,.docx',
  multiple: true,
  maxSize: 100, // 100MB max via direct upload
}

export const FileBlock: BlockConfig<FileParserOutput> = {
  type: 'file',
  name: 'File',
  description: 'Read and parse multiple files',
  longDescription: `Upload and extract contents from structured file formats including PDFs, CSV spreadsheets, and Word documents (DOCX). ${
    shouldEnableURLInput
      ? 'You can either provide a URL to a file or upload files directly. '
      : 'Upload files directly. '
  }Specialized parsers extract text and metadata from each format. You can upload multiple files at once and access them individually or as a combined document.`,
  docsLink: 'https://docs.simstudio.ai/tools/file',
  category: 'tools',
  bgColor: '#40916C',
  icon: DocumentIcon,
  subBlocks: [
    ...(shouldEnableURLInput ? [inputMethodBlock] : []),
    {
      id: 'filePath',
      title: 'File URL',
      type: 'short-input' as SubBlockType,
      layout: 'full' as SubBlockLayout,
      placeholder: 'Enter URL to a file (https://example.com/document.pdf)',
      ...(shouldEnableURLInput
        ? {
            condition: {
              field: 'inputMethod',
              value: 'url',
            },
          }
        : {}),
    },

    {
      ...fileUploadBlock,
      ...(shouldEnableURLInput ? { condition: { field: 'inputMethod', value: 'upload' } } : {}),
    },
  ],
  tools: {
    access: ['file_parser'],
    config: {
      tool: () => 'file_parser',
      params: (params) => {
        // Determine input method based on whether URL input is enabled
        const inputMethod = shouldEnableURLInput ? params.inputMethod || 'url' : 'upload'

        if (inputMethod === 'url') {
          if (!params.filePath || params.filePath.trim() === '') {
            logger.error('Missing file URL')
            throw new Error('File URL is required')
          }

          const fileUrl = params.filePath.trim()

          return {
            filePath: fileUrl,
            fileType: params.fileType || 'auto',
          }
        }

        // Handle file upload input (always possible, default if URL input disabled)
        if (inputMethod === 'upload') {
          // Handle case where 'file' is an array (multiple files)
          if (params.file && Array.isArray(params.file) && params.file.length > 0) {
            const filePaths = params.file.map((file) => file.path)

            return {
              filePath: filePaths.length === 1 ? filePaths[0] : filePaths,
              fileType: params.fileType || 'auto',
            }
          }

          // Handle case where 'file' is a single file object
          if (params.file?.path) {
            return {
              filePath: params.file.path,
              fileType: params.fileType || 'auto',
            }
          }

          // If no files, return error
          logger.error('No files provided for upload method')
          throw new Error('Please upload a file') // Changed error message slightly
        }

        // This part should ideally not be reached if logic above is correct
        logger.error(`Invalid configuration or state: ${inputMethod}`)
        throw new Error('Invalid configuration: Unable to determine input method')
      },
    },
  },
  inputs: {
    // Conditionally require inputMethod and filePath only if URL input is enabled
    ...(shouldEnableURLInput
      ? {
          inputMethod: { type: 'string', required: false }, // Not strictly required as it defaults
          filePath: { type: 'string', required: false }, // Required only if inputMethod is 'url' (validated in params)
        }
      : {}),
    fileType: { type: 'string', required: false },
    // File input is always potentially needed, but only required if method is 'upload' (validated in params)
    file: { type: 'json', required: false },
  },
  outputs: {
    files: 'json',
    combinedContent: 'string',
  },
}
