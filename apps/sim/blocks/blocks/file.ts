import { DocumentIcon } from '@/components/icons'
import { createLogger } from '@/lib/logs/console/logger'
import type { BlockConfig, SubBlockLayout, SubBlockType } from '@/blocks/types'
import type { FileParserOutput } from '@/tools/file/types'

const logger = createLogger('FileBlock')

export const FileBlock: BlockConfig<FileParserOutput> = {
  type: 'file',
  name: 'File',
  description: 'Read and parse multiple files',
  longDescription: `Integrate File into the workflow. Can upload a file manually or insert a file url.`,
  bestPractices: `
  - You should always use the File URL input method and enter the file URL if the user gives it to you or clarify if they have one.
  `,
  docsLink: 'https://docs.sim.ai/tools/file',
  category: 'tools',
  bgColor: '#40916C',
  icon: DocumentIcon,
  subBlocks: [
    {
      id: 'inputMethod',
      title: 'Select Input Method',
      type: 'dropdown' as SubBlockType,
      layout: 'full' as SubBlockLayout,
      options: [
        { id: 'url', label: 'File URL' },
        { id: 'upload', label: 'Upload Files' },
      ],
    },
    {
      id: 'filePath',
      title: 'File URL',
      type: 'short-input' as SubBlockType,
      layout: 'full' as SubBlockLayout,
      placeholder: 'Enter URL to a file (https://example.com/document.pdf)',
      condition: {
        field: 'inputMethod',
        value: 'url',
      },
    },

    {
      id: 'file',
      title: 'Upload Files',
      type: 'file-upload' as SubBlockType,
      layout: 'full' as SubBlockLayout,
      acceptedTypes: '.pdf,.csv,.doc,.docx,.txt,.md,.xlsx,.xls,.html,.htm,.pptx,.ppt',
      multiple: true,
      condition: {
        field: 'inputMethod',
        value: 'upload',
      },
      maxSize: 100, // 100MB max via direct upload
    },
  ],
  tools: {
    access: ['file_parser'],
    config: {
      tool: () => 'file_parser',
      params: (params) => {
        // Determine input method - default to 'url' if not specified
        const inputMethod = params.inputMethod || 'url'

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

        // Handle file upload input
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
          throw new Error('Please upload a file')
        }

        // This part should ideally not be reached if logic above is correct
        logger.error(`Invalid configuration or state: ${inputMethod}`)
        throw new Error('Invalid configuration: Unable to determine input method')
      },
    },
  },
  inputs: {
    inputMethod: { type: 'string', description: 'Input method selection' },
    filePath: { type: 'string', description: 'File URL path' },
    fileType: { type: 'string', description: 'File type' },
    file: { type: 'json', description: 'Uploaded file data' },
  },
  outputs: {
    files: {
      type: 'json',
      description: 'Array of parsed file objects with content, metadata, and file properties',
    },
    combinedContent: {
      type: 'string',
      description: 'All file contents merged into a single text string',
    },
  },
}
