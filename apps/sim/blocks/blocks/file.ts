import { createLogger } from '@sim/logger'
import { DocumentIcon } from '@/components/icons'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import type { BlockConfig, SubBlockType } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
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

const resolveHttpFileUrl = (value: unknown): string => {
  const fileUrl = typeof value === 'string' ? value.trim() : ''
  if (!fileUrl) {
    throw new Error('File URL is required')
  }

  let parsed: URL
  try {
    parsed = new URL(fileUrl)
  } catch {
    throw new Error('File URL must be a valid http or https URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('File URL must use http or https')
  }

  return fileUrl
}

export const FileBlock: BlockConfig<FileParserOutput> = {
  type: 'file',
  name: 'File (Legacy)',
  description: 'Read and parse multiple files',
  longDescription: `Integrate File into the workflow. Can upload a file manually or insert a file url.`,
  bestPractices: `
  - You should always use the File URL input method and enter the file URL if the user gives it to you or clarify if they have one.
  `,
  docsLink: 'https://docs.sim.ai/integrations/file',
  category: 'blocks',
  integrationType: IntegrationType.Documents,
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
  description: 'Read and write workspace files',
  longDescription:
    'Read and parse files from uploads or URLs, write new workspace files, or append content to existing files.',
  docsLink: 'https://docs.sim.ai/integrations/file',
  category: 'blocks',
  integrationType: IntegrationType.Documents,
  bgColor: '#40916C',
  icon: DocumentIcon,
  hideFromToolbar: true,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown' as SubBlockType,
      options: [
        { label: 'Read', id: 'file_parser_v3' },
        { label: 'Get', id: 'file_get' },
        { label: 'Write', id: 'file_write' },
        { label: 'Append', id: 'file_append' },
      ],
      value: () => 'file_parser_v3',
    },
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
      required: { field: 'operation', value: 'file_parser_v3' },
      condition: { field: 'operation', value: 'file_parser_v3' },
    },
    {
      id: 'fileUrl',
      title: 'File URL',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'fileInput',
      placeholder: 'https://example.com/document.pdf',
      mode: 'advanced',
      required: { field: 'operation', value: 'file_parser_v3' },
      condition: { field: 'operation', value: 'file_parser_v3' },
    },
    {
      id: 'getFile',
      title: 'File',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'getFileInput',
      acceptedTypes: '*',
      placeholder: 'Select a workspace file',
      multiple: false,
      mode: 'basic',
      condition: { field: 'operation', value: 'file_get' },
      required: { field: 'operation', value: 'file_get' },
    },
    {
      id: 'getFileId',
      title: 'File ID',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'getFileInput',
      placeholder: 'Workspace file ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_get' },
      required: { field: 'operation', value: 'file_get' },
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input' as SubBlockType,
      placeholder: 'File name (e.g., data.csv)',
      condition: { field: 'operation', value: 'file_write' },
      required: { field: 'operation', value: 'file_write' },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input' as SubBlockType,
      placeholder: 'File content to write...',
      condition: { field: 'operation', value: 'file_write' },
      required: { field: 'operation', value: 'file_write' },
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'short-input' as SubBlockType,
      placeholder: 'text/plain (auto-detected from extension)',
      condition: { field: 'operation', value: 'file_write' },
      mode: 'advanced',
    },
    {
      id: 'appendFile',
      title: 'File',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'appendFileInput',
      acceptedTypes: '.txt,.md,.json,.csv,.xml,.html,.htm,.yaml,.yml,.log,.rtf',
      placeholder: 'Select or upload a workspace file',
      mode: 'basic',
      condition: { field: 'operation', value: 'file_append' },
      required: { field: 'operation', value: 'file_append' },
    },
    {
      id: 'appendFileName',
      title: 'File',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'appendFileInput',
      placeholder: 'File name (e.g., notes.md)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_append' },
      required: { field: 'operation', value: 'file_append' },
    },
    {
      id: 'appendContent',
      title: 'Content',
      type: 'long-input' as SubBlockType,
      placeholder: 'Content to append...',
      condition: { field: 'operation', value: 'file_append' },
      required: { field: 'operation', value: 'file_append' },
    },
  ],
  tools: {
    access: ['file_parser_v3', 'file_get', 'file_write', 'file_append'],
    config: {
      tool: (params) => params.operation || 'file_parser_v3',
      params: (params) => {
        const operation = params.operation || 'file_parser_v3'

        if (operation === 'file_write') {
          return {
            fileName: params.fileName,
            content: params.content,
            contentType: params.contentType,
            workspaceId: params._context?.workspaceId,
          }
        }

        if (operation === 'file_append') {
          const appendInput = params.appendFileInput
          if (!appendInput) {
            throw new Error('File is required for append')
          }

          let fileName: string
          if (typeof appendInput === 'string') {
            fileName = appendInput.trim()
          } else {
            const normalized = normalizeFileInput(appendInput, { single: true })
            const file = normalized as Record<string, unknown> | null
            fileName = (file?.name as string) ?? ''
          }

          if (!fileName) {
            throw new Error('Could not determine file name')
          }

          return {
            fileName,
            content: params.appendContent,
            workspaceId: params._context?.workspaceId,
          }
        }

        if (operation === 'file_get') {
          const getInput = params.getFileInput
          if (!getInput) {
            throw new Error('File is required for get')
          }

          if (typeof getInput === 'string') {
            return {
              fileId: getInput.trim(),
              workspaceId: params._context?.workspaceId,
            }
          }

          return {
            fileInput: normalizeFileInput(getInput, { single: true }),
            workspaceId: params._context?.workspaceId,
          }
        }

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
    operation: {
      type: 'string',
      description: 'Operation to perform (read, get, write, or append)',
    },
    fileInput: { type: 'json', description: 'File input for read' },
    fileType: { type: 'string', description: 'File type for read' },
    getFileInput: { type: 'json', description: 'Selected file or workspace file ID for get' },
    fileName: { type: 'string', description: 'Name for a new file (write)' },
    content: { type: 'string', description: 'File content to write' },
    contentType: { type: 'string', description: 'MIME content type for write' },
    appendFileInput: { type: 'json', description: 'File to append to' },
    appendContent: { type: 'string', description: 'Content to append to file' },
  },
  outputs: {
    files: {
      type: 'file[]',
      description: 'Parsed files as UserFile objects (read)',
    },
    combinedContent: {
      type: 'string',
      description: 'All file contents merged into a single text string (read)',
    },
    file: {
      type: 'file',
      description: 'Workspace file object (get)',
    },
    id: {
      type: 'string',
      description: 'File ID (write)',
    },
    name: {
      type: 'string',
      description: 'File name (write)',
    },
    size: {
      type: 'number',
      description: 'File size in bytes (write)',
    },
    url: {
      type: 'string',
      description: 'URL to access the file (write)',
    },
  },
}

const parseReadFileIds = (input: unknown): string | string[] | null => {
  let value = input

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    try {
      value = JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }

  if (Array.isArray(value)) {
    const fileIds = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0)

    if (fileIds.length === 0) return null
    return fileIds.length === 1 ? fileIds[0] : fileIds
  }

  return null
}

export const FileV4Block: BlockConfig<FileParserV3Output> = {
  ...FileV3Block,
  type: 'file_v4',
  name: 'File (Legacy)',
  description: 'Read, fetch, write, and append files',
  longDescription:
    'Read workspace files by picker or canonical ID, fetch and parse files from URLs with optional headers, write new workspace files, or append content to existing files.',
  hideFromToolbar: true,
  bestPractices: `
  - Use Read when you need an existing workspace file object by picker selection or canonical file ID.
  - Use Fetch for external file URLs. Add headers for authenticated downloads, for example Slack private file URLs require an Authorization Bearer token.
  `,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown' as SubBlockType,
      options: [
        { label: 'Read', id: 'file_read' },
        { label: 'Fetch', id: 'file_fetch' },
        { label: 'Write', id: 'file_write' },
        { label: 'Append', id: 'file_append' },
      ],
      value: () => 'file_read',
    },
    {
      id: 'readFile',
      title: 'File',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'readFileInput',
      acceptedTypes: '*',
      placeholder: 'Select workspace files',
      multiple: true,
      mode: 'basic',
      condition: { field: 'operation', value: 'file_read' },
      required: { field: 'operation', value: 'file_read' },
    },
    {
      id: 'readFileId',
      title: 'File ID',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'readFileInput',
      placeholder: 'Workspace file ID or JSON array of IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_read' },
      required: { field: 'operation', value: 'file_read' },
    },
    {
      id: 'fileUrl',
      title: 'File URL',
      type: 'short-input' as SubBlockType,
      placeholder: 'https://example.com/document.pdf',
      condition: { field: 'operation', value: 'file_fetch' },
      required: { field: 'operation', value: 'file_fetch' },
    },
    {
      id: 'headers',
      title: 'Headers',
      type: 'table' as SubBlockType,
      columns: ['Key', 'Value'],
      description:
        'Custom headers for fetching the file URL, such as Authorization: Bearer <token>.',
      condition: { field: 'operation', value: 'file_fetch' },
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input' as SubBlockType,
      placeholder: 'File name (e.g., data.csv)',
      condition: { field: 'operation', value: 'file_write' },
      required: { field: 'operation', value: 'file_write' },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input' as SubBlockType,
      placeholder: 'File content to write...',
      condition: { field: 'operation', value: 'file_write' },
      required: { field: 'operation', value: 'file_write' },
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'short-input' as SubBlockType,
      placeholder: 'text/plain (auto-detected from extension)',
      condition: { field: 'operation', value: 'file_write' },
      mode: 'advanced',
    },
    {
      id: 'appendFile',
      title: 'File',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'appendFileInput',
      acceptedTypes: '.txt,.md,.json,.csv,.xml,.html,.htm,.yaml,.yml,.log,.rtf',
      placeholder: 'Select or upload a workspace file',
      mode: 'basic',
      condition: { field: 'operation', value: 'file_append' },
      required: { field: 'operation', value: 'file_append' },
    },
    {
      id: 'appendFileName',
      title: 'File',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'appendFileInput',
      placeholder: 'File name (e.g., notes.md)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_append' },
      required: { field: 'operation', value: 'file_append' },
    },
    {
      id: 'appendContent',
      title: 'Content',
      type: 'long-input' as SubBlockType,
      placeholder: 'Content to append...',
      condition: { field: 'operation', value: 'file_append' },
      required: { field: 'operation', value: 'file_append' },
    },
  ],
  tools: {
    access: ['file_fetch', 'file_read', 'file_write', 'file_append'],
    config: {
      tool: (params) => {
        const operation = params.operation || 'file_read'
        if (operation === 'file_read') return 'file_read'
        if (operation === 'file_fetch') return 'file_fetch'
        return operation
      },
      params: (params) => {
        const operation = params.operation || 'file_read'

        if (operation === 'file_write') {
          return {
            fileName: params.fileName,
            content: params.content,
            contentType: params.contentType,
            workspaceId: params._context?.workspaceId,
          }
        }

        if (operation === 'file_append') {
          const appendInput = params.appendFileInput
          if (!appendInput) {
            throw new Error('File is required for append')
          }

          let fileName: string
          if (typeof appendInput === 'string') {
            fileName = appendInput.trim()
          } else {
            const normalized = normalizeFileInput(appendInput, { single: true })
            const file = normalized as Record<string, unknown> | null
            fileName = (file?.name as string) ?? ''
          }

          if (!fileName) {
            throw new Error('Could not determine file name')
          }

          return {
            fileName,
            content: params.appendContent,
            workspaceId: params._context?.workspaceId,
          }
        }

        if (operation === 'file_read') {
          const readInput = params.readFileInput
          if (!readInput) {
            throw new Error('File is required for read')
          }

          const fileIds = parseReadFileIds(readInput)
          if (fileIds) {
            return {
              fileId: fileIds,
              workspaceId: params._context?.workspaceId,
            }
          }

          const normalized = normalizeFileInput(readInput)
          if (!normalized || normalized.length === 0) {
            throw new Error('File is required for read')
          }

          return {
            fileInput: normalized,
            workspaceId: params._context?.workspaceId,
          }
        }

        if (operation === 'file_fetch') {
          const fileUrl = resolveHttpFileUrl(params.fileUrl)

          return {
            filePath: fileUrl,
            fileType: params.fileType || 'auto',
            headers: params.headers,
            workspaceId: params._context?.workspaceId,
            workflowId: params._context?.workflowId,
            executionId: params._context?.executionId,
          }
        }

        logger.error(`Invalid file operation: ${operation}`)
        throw new Error('Invalid file operation')
      },
    },
  },
  inputs: {
    operation: {
      type: 'string',
      description: 'Operation to perform (read, fetch, write, or append)',
    },
    readFileInput: {
      type: 'json',
      description: 'Selected workspace file or canonical file ID for read',
    },
    fileUrl: { type: 'string', description: 'External file URL for fetch' },
    headers: { type: 'json', description: 'Request headers for fetch' },
    fileType: { type: 'string', description: 'File type for fetch' },
    fileName: { type: 'string', description: 'Name for a new file (write)' },
    content: { type: 'string', description: 'File content to write' },
    contentType: { type: 'string', description: 'MIME content type for write' },
    appendFileInput: { type: 'json', description: 'File to append to' },
    appendContent: { type: 'string', description: 'Content to append to file' },
  },
  outputs: {
    file: {
      type: 'file',
      description: 'First workspace file object (read)',
    },
    files: {
      type: 'file[]',
      description: 'Workspace file objects (read) or fetched file objects (fetch)',
    },
    combinedContent: {
      type: 'string',
      description: 'All fetched file contents merged into a single text string (fetch)',
    },
    id: {
      type: 'string',
      description: 'File ID (write)',
    },
    name: {
      type: 'string',
      description: 'File name (write)',
    },
    size: {
      type: 'number',
      description: 'File size in bytes (write)',
    },
    url: {
      type: 'string',
      description: 'URL to access the file (write)',
    },
  },
}

export const FileV5Block: BlockConfig<FileParserV3Output> = {
  ...FileV4Block,
  type: 'file_v5',
  name: 'File',
  description:
    'Read, get content, fetch, write, append, compress, decompress, and manage sharing for files',
  longDescription:
    'Read workspace file objects, extract the text content of files, fetch and parse files from URLs with optional headers, write new workspace files, append content to existing files, compress files into a .zip archive, extract a .zip archive into the workspace, or manage the public share link for a file.',
  hideFromToolbar: false,
  bestPractices: `
  - Read returns workspace file objects in the "files" output and does NOT include their text. Use it to pick files or pass file references downstream (e.g. as attachments).
  - Get Content is how you read file text. It accepts file objects or canonical file IDs and returns a "contents" array with one extracted text string per file (PDF, DOCX, CSV, etc. are parsed automatically).
  - To read the text of files produced by another block, chain into Get Content: set its file input to the upstream file output, e.g. <file.files>, <agent.files>, or <start.files>. Never assume Read (or any file-object output) already contains the text.
  - Get Content's "contents" can be large; it is persisted through the execution large-value system automatically, so prefer it over inlining file text any other way.
  - Use Fetch for external file URLs. Add headers for authenticated downloads, for example Slack private file URLs require an Authorization Bearer token.
  - Use Write to create a new workspace file and Append to add content to an existing one.
  - Use Compress to bundle one or more files into a single .zip archive stored in the workspace. The new archive is returned in the "files" output.
  - Use Decompress to extract a .zip archive back into the workspace; the extracted files are returned in the "files" output, ready to chain into Get Content or downstream blocks.
  `,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown' as SubBlockType,
      options: [
        { label: 'Read', id: 'file_read' },
        { label: 'Get Content', id: 'file_get_content' },
        { label: 'Fetch', id: 'file_fetch' },
        { label: 'Write', id: 'file_write' },
        { label: 'Append', id: 'file_append' },
        { label: 'Compress', id: 'file_compress' },
        { label: 'Decompress', id: 'file_decompress' },
        { label: 'Manage Sharing', id: 'file_manage_sharing' },
      ],
      value: () => 'file_read',
    },
    {
      id: 'readFile',
      title: 'Files',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'readFileInput',
      acceptedTypes: '*',
      placeholder: 'Select workspace files',
      multiple: true,
      mode: 'basic',
      condition: { field: 'operation', value: 'file_read' },
      required: { field: 'operation', value: 'file_read' },
    },
    {
      id: 'readFileId',
      title: 'File ID',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'readFileInput',
      placeholder: 'Workspace file ID or JSON array of IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_read' },
      required: { field: 'operation', value: 'file_read' },
    },
    {
      id: 'getContentFile',
      title: 'Files',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'getContentInput',
      acceptedTypes: '*',
      placeholder: 'Select workspace files',
      multiple: true,
      mode: 'basic',
      condition: { field: 'operation', value: 'file_get_content' },
      required: { field: 'operation', value: 'file_get_content' },
    },
    {
      id: 'getContentFileId',
      title: 'File ID',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'getContentInput',
      placeholder: 'Workspace file ID or JSON array of IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_get_content' },
      required: { field: 'operation', value: 'file_get_content' },
    },
    {
      id: 'fileUrl',
      title: 'File URL',
      type: 'short-input' as SubBlockType,
      placeholder: 'https://example.com/document.pdf',
      condition: { field: 'operation', value: 'file_fetch' },
      required: { field: 'operation', value: 'file_fetch' },
    },
    {
      id: 'headers',
      title: 'Headers',
      type: 'table' as SubBlockType,
      columns: ['Key', 'Value'],
      description:
        'Custom headers for fetching the file URL, such as Authorization: Bearer <token>.',
      condition: { field: 'operation', value: 'file_fetch' },
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input' as SubBlockType,
      placeholder: 'File name (e.g., data.csv)',
      condition: { field: 'operation', value: 'file_write' },
      required: { field: 'operation', value: 'file_write' },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input' as SubBlockType,
      placeholder: 'File content to write...',
      condition: { field: 'operation', value: 'file_write' },
      required: { field: 'operation', value: 'file_write' },
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'short-input' as SubBlockType,
      placeholder: 'text/plain (auto-detected from extension)',
      condition: { field: 'operation', value: 'file_write' },
      mode: 'advanced',
    },
    {
      id: 'appendFile',
      title: 'File',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'appendFileInput',
      acceptedTypes: '.txt,.md,.json,.csv,.xml,.html,.htm,.yaml,.yml,.log,.rtf',
      placeholder: 'Select or upload a workspace file',
      mode: 'basic',
      condition: { field: 'operation', value: 'file_append' },
      required: { field: 'operation', value: 'file_append' },
    },
    {
      id: 'appendFileName',
      title: 'File',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'appendFileInput',
      placeholder: 'File name (e.g., notes.md)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_append' },
      required: { field: 'operation', value: 'file_append' },
    },
    {
      id: 'appendContent',
      title: 'Content',
      type: 'long-input' as SubBlockType,
      placeholder: 'Content to append...',
      condition: { field: 'operation', value: 'file_append' },
      required: { field: 'operation', value: 'file_append' },
    },
    {
      id: 'compressFile',
      title: 'Files',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'compressInput',
      acceptedTypes: '*',
      placeholder: 'Select workspace files',
      multiple: true,
      mode: 'basic',
      condition: { field: 'operation', value: 'file_compress' },
      required: { field: 'operation', value: 'file_compress' },
    },
    {
      id: 'compressFileId',
      title: 'File ID',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'compressInput',
      placeholder: 'Workspace file ID or JSON array of IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_compress' },
      required: { field: 'operation', value: 'file_compress' },
    },
    {
      id: 'archiveName',
      title: 'Archive Name',
      type: 'short-input' as SubBlockType,
      placeholder: 'archive.zip (auto-named from source if omitted)',
      condition: { field: 'operation', value: 'file_compress' },
    },
    {
      id: 'decompressFile',
      title: 'Archive',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'decompressInput',
      acceptedTypes: '.zip',
      placeholder: 'Select a .zip archive',
      mode: 'basic',
      condition: { field: 'operation', value: 'file_decompress' },
      required: { field: 'operation', value: 'file_decompress' },
    },
    {
      id: 'decompressFileId',
      title: 'File ID',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'decompressInput',
      placeholder: 'Workspace file ID of the .zip archive',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_decompress' },
      required: { field: 'operation', value: 'file_decompress' },
    },
    {
      id: 'shareFile',
      title: 'File',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'shareInput',
      acceptedTypes: '*',
      placeholder: 'Select a workspace file',
      mode: 'basic',
      condition: { field: 'operation', value: 'file_manage_sharing' },
      required: { field: 'operation', value: 'file_manage_sharing' },
    },
    {
      id: 'shareFileId',
      title: 'File ID',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'shareInput',
      placeholder: 'Workspace file ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_manage_sharing' },
      required: { field: 'operation', value: 'file_manage_sharing' },
    },
    {
      id: 'shareVisibility',
      title: 'Visibility',
      type: 'dropdown' as SubBlockType,
      options: [
        { label: 'Private (disable link)', id: 'private' },
        { label: 'Anyone with the link', id: 'public' },
        { label: 'Password protected', id: 'password' },
        { label: 'Email allowlist', id: 'email' },
        { label: 'SSO', id: 'sso' },
      ],
      value: () => 'public',
      condition: { field: 'operation', value: 'file_manage_sharing' },
    },
    {
      id: 'sharePassword',
      title: 'Password',
      type: 'short-input' as SubBlockType,
      password: true,
      placeholder: 'Password for the public link',
      condition: {
        field: 'operation',
        value: 'file_manage_sharing',
        and: { field: 'shareVisibility', value: 'password' },
      },
      required: {
        field: 'operation',
        value: 'file_manage_sharing',
        and: { field: 'shareVisibility', value: 'password' },
      },
    },
    {
      id: 'shareAllowedEmails',
      title: 'Allowed Emails',
      type: 'long-input' as SubBlockType,
      placeholder: 'Comma- or newline-separated emails or @domain patterns',
      condition: {
        field: 'operation',
        value: 'file_manage_sharing',
        and: { field: 'shareVisibility', value: ['email', 'sso'] },
      },
      required: {
        field: 'operation',
        value: 'file_manage_sharing',
        and: { field: 'shareVisibility', value: ['email', 'sso'] },
      },
    },
  ],
  tools: {
    access: [
      'file_read',
      'file_get_content',
      'file_fetch',
      'file_write',
      'file_append',
      'file_compress',
      'file_decompress',
      'file_manage_sharing',
    ],
    config: {
      tool: (params) => params.operation || 'file_read',
      params: (params) => {
        const operation = params.operation || 'file_read'

        if (operation === 'file_write') {
          return {
            fileName: params.fileName,
            content: params.content,
            contentType: params.contentType,
            workspaceId: params._context?.workspaceId,
          }
        }

        if (operation === 'file_append') {
          const appendInput = params.appendFileInput
          if (!appendInput) {
            throw new Error('File is required for append')
          }

          let fileName: string
          if (typeof appendInput === 'string') {
            fileName = appendInput.trim()
          } else {
            const normalized = normalizeFileInput(appendInput, { single: true })
            const file = normalized as Record<string, unknown> | null
            fileName = (file?.name as string) ?? ''
          }

          if (!fileName) {
            throw new Error('Could not determine file name')
          }

          return {
            fileName,
            content: params.appendContent,
            workspaceId: params._context?.workspaceId,
          }
        }

        if (operation === 'file_compress') {
          const compressInput = params.compressInput
          if (!compressInput) {
            throw new Error('File is required for compress')
          }

          const archiveName =
            typeof params.archiveName === 'string' && params.archiveName.trim()
              ? params.archiveName.trim()
              : undefined

          const fileIds = parseReadFileIds(compressInput)
          if (fileIds) {
            return {
              fileId: fileIds,
              archiveName,
              workspaceId: params._context?.workspaceId,
            }
          }

          const normalized = normalizeFileInput(compressInput)
          if (!normalized || normalized.length === 0) {
            throw new Error('File is required for compress')
          }

          return {
            fileInput: normalized,
            archiveName,
            workspaceId: params._context?.workspaceId,
          }
        }

        if (operation === 'file_decompress') {
          const decompressInput = params.decompressInput
          if (!decompressInput) {
            throw new Error('File is required for decompress')
          }

          const fileIds = parseReadFileIds(decompressInput)
          if (fileIds) {
            const ids = Array.isArray(fileIds) ? fileIds : [fileIds]
            if (ids.length > 1) {
              throw new Error('Decompress accepts a single .zip archive at a time')
            }
            return {
              fileId: ids[0],
              workspaceId: params._context?.workspaceId,
            }
          }

          const normalized = normalizeFileInput(decompressInput)
          if (!normalized || normalized.length === 0) {
            throw new Error('File is required for decompress')
          }
          if (normalized.length > 1) {
            throw new Error('Decompress accepts a single .zip archive at a time')
          }

          return {
            fileInput: normalized[0],
            workspaceId: params._context?.workspaceId,
          }
        }

        if (operation === 'file_manage_sharing') {
          const shareInput = params.shareInput
          if (!shareInput) {
            throw new Error('File is required to manage sharing')
          }

          let fileId: string
          const fileIds = parseReadFileIds(shareInput)
          if (fileIds) {
            if (Array.isArray(fileIds) && fileIds.length > 1) {
              throw new Error('Manage Sharing accepts a single file at a time')
            }
            fileId = Array.isArray(fileIds) ? fileIds[0] : fileIds
          } else {
            const normalized = normalizeFileInput(shareInput, { single: true })
            const file = normalized as Record<string, unknown> | null
            fileId = (file?.id as string) ?? ''
          }
          if (!fileId) {
            throw new Error('Could not determine the file to share')
          }

          const allowedEmails =
            typeof params.shareAllowedEmails === 'string'
              ? params.shareAllowedEmails
                  .split(/[\n,]/)
                  .map((email) => email.trim())
                  .filter(Boolean)
              : undefined

          const visibility = (params.shareVisibility as string) || 'public'
          const isActive = visibility !== 'private'

          return {
            fileId,
            isActive,
            // When disabling, leave authType unset so the stored access mode is preserved.
            authType: isActive ? visibility : undefined,
            password: params.sharePassword,
            allowedEmails,
            workspaceId: params._context?.workspaceId,
          }
        }

        if (operation === 'file_fetch') {
          const fileUrl = resolveHttpFileUrl(params.fileUrl)

          return {
            filePath: fileUrl,
            fileType: params.fileType || 'auto',
            headers: params.headers,
            workspaceId: params._context?.workspaceId,
            workflowId: params._context?.workflowId,
            executionId: params._context?.executionId,
          }
        }

        if (operation === 'file_get_content') {
          const getContentInput = params.getContentInput
          if (!getContentInput) {
            throw new Error('File is required for get content')
          }

          const fileIds = parseReadFileIds(getContentInput)
          if (fileIds) {
            return {
              fileId: fileIds,
              workspaceId: params._context?.workspaceId,
            }
          }

          const normalized = normalizeFileInput(getContentInput)
          if (!normalized || normalized.length === 0) {
            throw new Error('File is required for get content')
          }

          return {
            fileInput: normalized,
            workspaceId: params._context?.workspaceId,
          }
        }

        const readInput = params.readFileInput
        if (!readInput) {
          throw new Error('File is required for read')
        }

        const fileIds = parseReadFileIds(readInput)
        if (fileIds) {
          return {
            fileId: fileIds,
            workspaceId: params._context?.workspaceId,
          }
        }

        const normalized = normalizeFileInput(readInput)
        if (!normalized || normalized.length === 0) {
          throw new Error('File is required for read')
        }

        return {
          fileInput: normalized,
          workspaceId: params._context?.workspaceId,
        }
      },
    },
  },
  inputs: {
    operation: {
      type: 'string',
      description: 'Operation to perform (read, get content, fetch, write, or append)',
    },
    readFileInput: {
      type: 'json',
      description: 'Selected workspace file or canonical file ID for read',
    },
    getContentInput: {
      type: 'json',
      description: 'Selected workspace file or canonical file ID to extract content from',
    },
    fileUrl: { type: 'string', description: 'External file URL for fetch' },
    headers: { type: 'json', description: 'Request headers for fetch' },
    fileType: { type: 'string', description: 'File type for fetch' },
    fileName: { type: 'string', description: 'Name for a new file (write)' },
    content: { type: 'string', description: 'File content to write' },
    contentType: { type: 'string', description: 'MIME content type for write' },
    appendFileInput: { type: 'json', description: 'File to append to' },
    appendContent: { type: 'string', description: 'Content to append to file' },
    compressInput: {
      type: 'json',
      description: 'Selected workspace files or canonical file IDs to compress',
    },
    archiveName: { type: 'string', description: 'Name for the compressed .zip archive' },
    decompressInput: {
      type: 'json',
      description: 'Selected .zip archive or canonical file ID to extract',
    },
    shareInput: {
      type: 'json',
      description: 'Selected workspace file or canonical file ID to manage sharing for',
    },
    shareVisibility: {
      type: 'string',
      description: 'Link visibility: private, public, password, email, or sso',
    },
    sharePassword: { type: 'string', description: 'Password for a password-protected link' },
    shareAllowedEmails: {
      type: 'string',
      description: 'Allowed emails or @domain patterns for email/SSO access',
    },
  },
  outputs: {
    files: {
      type: 'file[]',
      description:
        'Workspace file objects (read), fetched file objects (fetch), the compressed archive (compress), or extracted files (decompress)',
    },
    contents: {
      type: 'array',
      description: 'Array of file text contents, one entry per file (get content)',
    },
    combinedContent: {
      type: 'string',
      description: 'All fetched file contents merged into a single text string (fetch)',
    },
    id: {
      type: 'string',
      description: 'File ID (write and append)',
    },
    name: {
      type: 'string',
      description: 'File name (write and append)',
    },
    size: {
      type: 'number',
      description: 'File size in bytes (write and append)',
    },
    url: {
      type: 'string',
      description:
        'URL to access the file (write and append), or the public share link when shared; empty when set to private (manage sharing)',
    },
    isActive: {
      type: 'boolean',
      description: 'Whether the public link is enabled (manage sharing)',
    },
    authType: {
      type: 'string',
      description: 'Public link access mode: public, password, email, or sso (manage sharing)',
    },
    hasPassword: {
      type: 'boolean',
      description: 'Whether the public link is password-protected (manage sharing)',
    },
    allowedEmails: {
      type: 'array',
      description: 'Allowed emails/domains for email or SSO access (manage sharing)',
    },
  },
}
