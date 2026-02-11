import { createLogger } from '@sim/logger'
import { DocumentIcon } from '@/components/icons'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import type { BlockConfig, SubBlockType } from '@/blocks/types'
import { createVersionedToolSelector, normalizeFileInput } from '@/blocks/utils'
import type { FileParserOutput, FileParserV3Output } from '@/tools/file/types'

const logger = createLogger('FileBlock')

const resolveFilePathFromInput = (fileInput: unknown): string | null => {
  if (!fileInput || typeof fileInput !== 'object') {
    return null
  }

  const record = fileInput as Record<string, unknown>
  if (typeof record.path === 'string' && record.path.trim() !== '') {
    return record.path
  }
  if (typeof record.url === 'string' && record.url.trim() !== '') {
    return record.url
  }
  if (typeof record.key === 'string' && record.key.trim() !== '') {
    const key = record.key.trim()
    const context = typeof record.context === 'string' ? record.context : inferContextFromKey(key)
    return `/api/files/serve/${encodeURIComponent(key)}?context=${context}`
  }

  return null
}

const resolveFilePathsFromInput = (fileInput: unknown): string[] => {
  if (!fileInput) {
    return []
  }

  if (Array.isArray(fileInput)) {
    return fileInput
      .map((file) => resolveFilePathFromInput(file))
      .filter((path): path is string => Boolean(path))
  }

  const resolved = resolveFilePathFromInput(fileInput)
  return resolved ? [resolved] : []
}

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
          const filePaths = resolveFilePathsFromInput(params.file)
          if (filePaths.length > 0) {
            return {
              filePath: filePaths.length === 1 ? filePaths[0] : filePaths,
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
        // Use canonical 'fileInput' param directly
        const fileInput = params.fileInput
        if (!fileInput) {
          logger.error('No file input provided')
          throw new Error('File is required')
        }

        // First, try to normalize as file objects (handles JSON strings from advanced mode)
        const normalizedFiles = normalizeFileInput(fileInput)
        if (normalizedFiles) {
          const filePaths = resolveFilePathsFromInput(normalizedFiles)
          if (filePaths.length > 0) {
            return {
              filePath: filePaths.length === 1 ? filePaths[0] : filePaths,
              fileType: params.fileType || 'auto',
              workspaceId: params._context?.workspaceId,
            }
          }
        }

        // If normalization fails, treat as direct URL string
        if (typeof fileInput === 'string' && fileInput.trim()) {
          return {
            filePath: fileInput.trim(),
            fileType: params.fileType || 'auto',
            workspaceId: params._context?.workspaceId,
          }
        }

        logger.error('Invalid file input format')
        throw new Error('Invalid file input')
      },
    },
  },
  inputs: {
    fileInput: { type: 'json', description: 'File input (canonical param)' },
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
  longDescription:
    'Upload files directly or import from external URLs to get UserFile objects for use in other blocks.',
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
      acceptedTypes: '*',
      placeholder: 'Upload files to process',
      multiple: true,
      mode: 'basic',
      maxSize: 100,
      required: true,
    },
    {
      id: 'fileUrl',
      title: 'File URL',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'fileInput',
      placeholder: 'https://example.com/document.pdf',
      mode: 'advanced',
      required: true,
    },
  ],
  tools: {
    access: ['file_parser_v3'],
    config: {
      tool: () => 'file_parser_v3',
      params: (params) => {
        // Use canonical 'fileInput' param directly
        const fileInput = params.fileInput
        if (!fileInput) {
          logger.error('No file input provided')
          throw new Error('File input is required')
        }

        // First, try to normalize as file objects (handles JSON strings from advanced mode)
        const normalizedFiles = normalizeFileInput(fileInput)
        if (normalizedFiles) {
          const filePaths = resolveFilePathsFromInput(normalizedFiles)
          if (filePaths.length > 0) {
            return {
              filePath: filePaths.length === 1 ? filePaths[0] : filePaths,
              fileType: params.fileType || 'auto',
              workspaceId: params._context?.workspaceId,
              workflowId: params._context?.workflowId,
              executionId: params._context?.executionId,
            }
          }
        }

        // If normalization fails, treat as direct URL string
        if (typeof fileInput === 'string' && fileInput.trim()) {
          return {
            filePath: fileInput.trim(),
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
    fileInput: { type: 'json', description: 'File input (canonical param)' },
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
