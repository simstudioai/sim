import { createLogger } from '@sim/logger'
import { DocumentIcon } from '@/components/icons'
import type { BlockConfig, SubBlockType } from '@/blocks/types'
import { createVersionedToolSelector } from '@/blocks/utils'
import type { FileParserOutput, FileParserV3Output } from '@/tools/file/types'

const logger = createLogger('FileBlock')

export const FileBlock: BlockConfig<FileParserOutput> = {
  type: 'file',
  name: 'File (Legacy)',
  description: 'Read and parse multiple files',
  longDescription: `Integrate File into the workflow. Can upload a file manually or insert a file url.`,
  bestPractices: `
  - You should always use the File URL input method and enter the file URL if the user gives it to you or clarify if they have one.
  `,
  docsLink: 'https://docs.sim.ai/tools/file',
  category: 'tools',
  bgColor: '#40916C',
  icon: DocumentIcon,
  hideFromToolbar: true,
  subBlocks: [
    {
      id: 'inputMethod',
      title: 'Select Input Method',
      type: 'dropdown' as SubBlockType,
      options: [
        { id: 'url', label: 'File URL' },
        { id: 'upload', label: 'Uploaded Files' },
      ],
    },
    {
      id: 'filePath',
      title: 'File URL',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter URL to a file (https://example.com/document.pdf)',
      condition: {
        field: 'inputMethod',
        value: 'url',
      },
    },

    {
      id: 'file',
      title: 'Process Files',
      type: 'file-upload' as SubBlockType,
      acceptedTypes:
        '.pdf,.csv,.doc,.docx,.txt,.md,.xlsx,.xls,.html,.htm,.pptx,.ppt,.json,.xml,.rtf',
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
            workspaceId: params._context?.workspaceId,
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
      type: 'file[]',
      description: 'Array of parsed file objects with content, metadata, and file properties',
    },
    combinedContent: {
      type: 'string',
      description: 'All file contents merged into a single text string',
    },
    processedFiles: {
      type: 'file[]',
      description: 'Array of UserFile objects for downstream use (attachments, uploads, etc.)',
    },
  },
}

export const FileV2Block: BlockConfig<FileParserOutput> = {
  ...FileBlock,
  type: 'file_v2',
  name: 'File (Legacy)',
  description: 'Read and parse multiple files',
  hideFromToolbar: true,
  subBlocks: [
    {
      id: 'file',
      title: 'Files',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'fileInput',
      acceptedTypes:
        '.pdf,.csv,.doc,.docx,.txt,.md,.xlsx,.xls,.html,.htm,.pptx,.ppt,.json,.xml,.rtf',
      placeholder: 'Upload files to process',
      multiple: true,
      mode: 'basic',
      maxSize: 100,
    },
    {
      id: 'filePath',
      title: 'Files',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'fileInput',
      placeholder: 'File URL',
      mode: 'advanced',
    },
  ],
  tools: {
    access: ['file_parser_v2'],
    config: {
      tool: createVersionedToolSelector({
        baseToolSelector: () => 'file_parser',
        suffix: '_v2',
        fallbackToolId: 'file_parser_v2',
      }),
      params: (params) => {
        const fileInput = params.file || params.filePath || params.fileInput
        if (!fileInput) {
          logger.error('No file input provided')
          throw new Error('File is required')
        }

        if (typeof fileInput === 'string') {
          return {
            filePath: fileInput.trim(),
            fileType: params.fileType || 'auto',
            workspaceId: params._context?.workspaceId,
          }
        }

        if (Array.isArray(fileInput) && fileInput.length > 0) {
          const filePaths = fileInput.map((file) => file.path)
          return {
            filePath: filePaths.length === 1 ? filePaths[0] : filePaths,
            fileType: params.fileType || 'auto',
          }
        }

        if (fileInput?.path) {
          return {
            filePath: fileInput.path,
            fileType: params.fileType || 'auto',
          }
        }

        logger.error('Invalid file input format')
        throw new Error('Invalid file input')
      },
    },
  },
  inputs: {
    fileInput: { type: 'json', description: 'File input (upload or URL reference)' },
    filePath: { type: 'string', description: 'File URL (advanced mode)' },
    file: { type: 'json', description: 'Uploaded file data (basic mode)' },
    fileType: { type: 'string', description: 'File type' },
  },
  outputs: {
    files: {
      type: 'file[]',
      description: 'Array of parsed file objects with content, metadata, and file properties',
    },
    combinedContent: {
      type: 'string',
      description: 'All file contents merged into a single text string',
    },
  },
}

export const FileV3Block: BlockConfig<FileParserV3Output> = {
  type: 'file_v3',
  name: 'File',
  description: 'Read and parse multiple files',
  longDescription: 'Upload files or reference files from previous blocks to extract text content.',
  docsLink: 'https://docs.sim.ai/tools/file',
  category: 'tools',
  bgColor: '#40916C',
  icon: DocumentIcon,
  subBlocks: [
    {
      id: 'file',
      title: 'Files',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'fileInput',
      acceptedTypes:
        '.pdf,.csv,.doc,.docx,.txt,.md,.xlsx,.xls,.html,.htm,.pptx,.ppt,.json,.xml,.rtf',
      placeholder: 'Upload files to process',
      multiple: true,
      mode: 'basic',
      maxSize: 100,
      required: true,
    },
    {
      id: 'fileRef',
      title: 'Files',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'fileInput',
      placeholder: 'File reference from previous block',
      mode: 'advanced',
      required: true,
    },
  ],
  tools: {
    access: ['file_parser_v3'],
    config: {
      tool: () => 'file_parser_v3',
      params: (params) => {
        const fileInput = params.fileInput ?? params.file ?? params.filePath
        if (!fileInput) {
          logger.error('No file input provided')
          throw new Error('File input is required')
        }

        if (typeof fileInput === 'string') {
          return {
            filePath: fileInput.trim(),
            fileType: params.fileType || 'auto',
            workspaceId: params._context?.workspaceId,
            workflowId: params._context?.workflowId,
            executionId: params._context?.executionId,
          }
        }

        if (Array.isArray(fileInput)) {
          const filePaths = fileInput
            .map((file) => (file as { url?: string; path?: string }).url || file.path)
            .filter((path): path is string => Boolean(path))
          if (filePaths.length === 0) {
            logger.error('No valid file paths found in file input array')
            throw new Error('File input is required')
          }
          return {
            filePath: filePaths.length === 1 ? filePaths[0] : filePaths,
            fileType: params.fileType || 'auto',
            workspaceId: params._context?.workspaceId,
            workflowId: params._context?.workflowId,
            executionId: params._context?.executionId,
          }
        }

        if (typeof fileInput === 'object') {
          const filePath = (fileInput as { url?: string; path?: string }).url || fileInput.path
          if (!filePath) {
            logger.error('File input object missing path or url')
            throw new Error('File input is required')
          }
          return {
            filePath,
            fileType: params.fileType || 'auto',
            workspaceId: params._context?.workspaceId,
            workflowId: params._context?.workflowId,
            executionId: params._context?.executionId,
          }
        }

        logger.error('Invalid file input format')
        throw new Error('File input is required')
      },
    },
  },
  inputs: {
    fileInput: { type: 'json', description: 'File input (upload or UserFile reference)' },
    fileType: { type: 'string', description: 'File type' },
  },
  outputs: {
    files: {
      type: 'file[]',
      description: 'Parsed files as UserFile objects',
    },
    combinedContent: {
      type: 'string',
      description: 'All file contents merged into a single text string',
    },
  },
}
