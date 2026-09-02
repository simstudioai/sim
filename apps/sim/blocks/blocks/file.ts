import { createLogger } from '@sim/logger'
import { DocumentIcon } from '@/components/icons'
import { encodeFolderPathSegment, ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { readFolderPath } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/sim-folder-tree-selector/selection'
import type { BlockConfig, SubBlockType } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import {
  createVersionedToolSelector,
  normalizeFileInput,
  parseOptionalNumberInput,
} from '@/blocks/utils'
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

/**
 * Canonical basic/advanced pairs, shared by the card summaries below.
 *
 * Every version of this block swaps a file picker for a raw id/URL input in
 * advanced mode, so a summary that named only the picker would silently vanish
 * for an advanced-mode user. Each alias lists both members of its group.
 */
const UPLOAD_OR_URL_FIELD = ['file', 'filePath'] as const
const V3_PARSE_FILE_FIELD = ['file', 'fileUrl'] as const
const V3_GET_FILE_FIELD = ['getFile', 'getFileId'] as const
const READ_FILE_FIELD = ['readFile', 'readFileId'] as const
const GET_CONTENT_FILE_FIELD = ['getContentFile', 'getContentFileId'] as const
const APPEND_FILE_FIELD = ['appendFile', 'appendFileName'] as const
const COMPRESS_FILE_FIELD = ['compressFile', 'compressFileId'] as const
const DECOMPRESS_FILE_FIELD = ['decompressFile', 'decompressFileId'] as const
const SHARE_FILE_FIELD = ['shareFile', 'shareFileId'] as const
/* Text and file are mutually exclusive sources, so the clause names whichever
   one the card actually carries. */
const WRITE_CONTENT_FIELD = ['content', 'writeFile', 'writeFileId'] as const
const FOLDER_SCOPE_FIELD = ['folderSelection', 'manualFolderSelection'] as const
const FOLDER_PATH_FIELD = ['folderPath', 'manualFolderPath'] as const
const WRITE_FOLDER_FIELD = ['writeFolderPath', 'manualWriteFolderPath'] as const
const CREATE_PARENT_FIELD = ['createParentPath', 'manualCreateParentPath'] as const
const DESTINATION_PARENT_FIELD = ['destinationParentPath', 'manualDestinationParentPath'] as const
const MOVE_TARGET_FIELD = ['moveTargetFolderPath', 'manualMoveTargetFolderPath'] as const

/**
 * The folder field, and the switch saying how deep it reaches, as the file
 * picker beside it needs them: a picker offering files outside the chosen
 * folder would let a selection be built that the run then ignores.
 */
const FOLDER_SCOPE = {
  fieldId: 'folderSelection',
  recursiveFieldId: 'folderIncludeSubfolders',
} as const

/*
 * An untouched text subblock arrives as '', not undefined, and '' is not a
 * canonical folder path — so an omitted optional path has to be normalized away
 * rather than forwarded. A switch arrives as either a boolean or the string
 * 'true' depending on how it was set.
 */
function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function switchValue(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback
  return value === true || value === 'true'
}

/**
 * The prefix a child path hangs off. The workspace root contributes nothing, so
 * a child of the root is `/name` rather than `//name`.
 */
function folderPathPrefix(parentPath: string | undefined): string {
  return parentPath && parentPath !== ROOT_FOLDER_PATH ? parentPath : ''
}

/** `parseReadFileIds` yields one id or many; spreading the single form would split its characters. */
function toFileIdList(value: string | string[] | null | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

/** Only the fields {@link fileFamilyInput} reads, so a shape change fails here rather than at run time. */
interface FileFamilyParams {
  folderScopeRef?: unknown
  folderIncludeSubfolders?: unknown
  _context?: { workspaceId?: string }
}

/**
 * What read, get content, and compress send: the files picked, the folder they
 * were picked from, or the folder alone.
 *
 * The picker only offers files inside the chosen folder, so a picked file is
 * always the narrower answer and the folder does not need to travel with it.
 * A folder on its own stands for its files, resolved when the workflow runs
 * rather than when it is configured — which is why it goes as a path and not as
 * the ids it covers today.
 */
function fileFamilyInput(
  params: FileFamilyParams,
  label: string,
  pickerValue: unknown
): Record<string, unknown> {
  const workspaceId = params._context?.workspaceId
  const fileIds = pickerValue ? parseReadFileIds(pickerValue) : null
  if (fileIds) return { fileId: toFileIdList(fileIds), workspaceId }

  const normalized = pickerValue ? normalizeFileInput(pickerValue) : null
  if (normalized && normalized.length > 0) return { fileInput: normalized, workspaceId }

  const folderPath = folderScopePath(params.folderScopeRef)
  if (!folderPath) {
    throw new Error(`File or folder is required for ${label}`)
  }
  return {
    folderPaths: [folderPath],
    /*
     * Absent already means "descend", so only the off case travels — a block
     * saved before this switch existed keeps reading whole subtrees.
     */
    ...(switchValue(params.folderIncludeSubfolders, true) ? {} : { includeSubfolders: false }),
    workspaceId,
  }
}

/**
 * The folder scope on a file operation: where the run looks.
 *
 * Kept as a path rather than the files it holds today, because the tools expand
 * it when the workflow runs — so a folder means whatever is inside it then, and
 * a file added tomorrow is read tomorrow.
 */
function folderScopePath(value: unknown): string | undefined {
  const path = readFolderPath(value)
  return path === ROOT_FOLDER_PATH ? undefined : path || undefined
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
  sunset: { status: 'legacy', replacedBy: 'file_v5' },
  canvasPresentation: {
    defaultTitle: 'File',
    sentences: {
      /* `inputMethod` has no default, so neither member of the pair is on a
         freshly-dropped card — the literal is what the card says until the user
         picks how to supply the file. */
      default: ['Parse a file', { text: 'from', field: UPLOAD_OR_URL_FIELD }],
    },
  },
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
  sunset: { status: 'legacy', replacedBy: 'file_v5' },
  canvasPresentation: {
    defaultTitle: 'File',
    sentences: {
      /* `inputMethod` has no default, so neither member of the pair is on a
         freshly-dropped card — the literal is what the card says until the user
         picks how to supply the file. */
      default: ['Parse a file', { text: 'from', field: UPLOAD_OR_URL_FIELD }],
    },
  },
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
  sunset: { status: 'legacy', replacedBy: 'file_v5' },
  canvasPresentation: {
    defaultTitle: 'File',
    sentences: {
      byOperation: {
        file_parser_v3: [{ text: 'Parse', field: V3_PARSE_FILE_FIELD, core: true }],
        file_get: [{ text: 'Get', field: V3_GET_FILE_FIELD, core: true }],
        file_write: [
          { text: 'Create', field: 'fileName', core: true },
          { text: 'containing', field: 'content' },
        ],
        file_append: [
          { text: 'Append', field: 'appendContent', core: true },
          { text: 'to', field: APPEND_FILE_FIELD, core: true },
        ],
      },
    },
  },
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
  sunset: { status: 'legacy', replacedBy: 'file_v5' },
  bestPractices: `
  - Use Read when you need an existing workspace file object by picker selection or canonical file ID.
  - Use Fetch for external file URLs. Add headers for authenticated downloads, for example Slack private file URLs require an Authorization Bearer token.
  `,
  canvasPresentation: {
    defaultTitle: 'File',
    sentences: {
      byOperation: {
        file_read: [{ text: 'Get', field: READ_FILE_FIELD, core: true }],
        file_fetch: [{ text: 'Fetch and parse', field: 'fileUrl', core: true }],
        file_write: [
          { text: 'Create', field: 'fileName', core: true },
          { text: 'containing', field: 'content' },
        ],
        file_append: [
          { text: 'Append', field: 'appendContent', core: true },
          { text: 'to', field: APPEND_FILE_FIELD, core: true },
        ],
      },
    },
  },
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
            fileUrl,
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
  sunset: undefined,
  type: 'file_v5',
  name: 'File',
  description:
    'Read, search, get content, fetch, write, append, compress, decompress, and manage sharing for files',
  longDescription:
    'Read workspace file objects, search indexed text across all active workspace files, extract the text content of files, fetch and parse files from URLs with optional headers, write new workspace files, append content to existing files, compress files into a .zip archive, extract a .zip archive into the workspace, or manage the public share link for a file.',
  hideFromToolbar: false,
  bestPractices: `
  - Read returns workspace file objects in the "files" output and does NOT include their text. Use it to pick files or pass file references downstream (e.g. as attachments).
  - Get Content is how you read file text. It accepts file objects or canonical file IDs and returns a "contents" array with one extracted text string per file (PDF, DOCX, CSV, etc. are parsed automatically).
  - To read the text of files produced by another block, chain into Get Content: set its file input to the upstream file output, e.g. <file.files>, <agent.files>, or <start.files>. Never assume Read (or any file-object output) already contains the text.
  - Get Content's "contents" can be large; it is persisted through the execution large-value system automatically, so prefer it over inlining file text any other way.
  - Search finds text across all active workspace files and returns one result per matching line — not per match — with fileId, lineNumber, and text. Queries are case-insensitive until they contain an uppercase letter being searched for; in a regular expression, uppercase inside an escape or character class such as \\D or [A-Z] does not affect this.
  - Search reads the query as a line-oriented regular expression: quantifiers, character classes, \\d \\w \\s, alternation, groups, "^" and "$" anchors, and \\b word boundaries. Lookaround, backreferences and patterns spanning a line break are not supported, and a pattern needs at least 3 consecutive literal characters that every match will contain. Set Match to "Exact match" to search for the query text verbatim instead.
  - Match is a builder setting, not an agent one: the agent writes the query, and Match decides how every query from that block is read.
  - Search is eventually consistent. Check "complete" and "indexStatus" when pending, failed, skipped, or partially indexed files matter to the task.
  - Use Fetch for external file URLs. Add headers for authenticated downloads, for example Slack private file URLs require an Authorization Bearer token.
  - Use Write to create a new workspace file and Append to add content to an existing one. Write adds a numeric suffix when the name is taken; turn on "Overwrite Existing File" to replace the contents of the file at that exact path (folder and name) instead — a same-named file in another folder is left alone.
  - Use Compress to bundle one or more files into a single .zip archive stored in the workspace. The new archive is returned in the "files" output.
  - Use Decompress to extract a .zip archive back into the workspace; the extracted files are returned in the "files" output, ready to chain into Get Content or downstream blocks.
  `,
  canvasPresentation: {
    defaultTitle: 'File',
    sentences: {
      byOperation: {
        file_read: [
          { text: 'Get', field: READ_FILE_FIELD, core: true },
          { text: 'in', field: FOLDER_SCOPE_FIELD },
        ],
        file_get_content: [
          { text: 'Extract text from', field: GET_CONTENT_FILE_FIELD, core: true },
          { text: 'in', field: FOLDER_SCOPE_FIELD },
        ],
        file_search: [{ text: 'Search workspace files for', field: 'query', core: true }],
        file_fetch: [{ text: 'Fetch and parse', field: 'fileUrl', core: true }],
        file_write: [
          { text: 'Create', field: 'fileName', core: true },
          { text: 'in', field: WRITE_FOLDER_FIELD },
          { text: 'containing', field: WRITE_CONTENT_FIELD },
        ],
        file_append: [
          { text: 'Append', field: 'appendContent', core: true },
          { text: 'to', field: APPEND_FILE_FIELD, core: true },
          { text: 'in', field: FOLDER_SCOPE_FIELD },
        ],
        file_compress: [
          { text: 'Compress', field: COMPRESS_FILE_FIELD, core: true },
          { text: 'in', field: FOLDER_SCOPE_FIELD },
          { text: 'into', field: 'archiveName' },
        ],
        file_list: [{ text: 'List', field: FOLDER_PATH_FIELD, core: true }],
        file_create_folder: [
          { text: 'Create folder', field: 'folderName', core: true },
          { text: 'in', field: CREATE_PARENT_FIELD },
        ],
        file_update_folder: [
          { text: 'Move folder', field: FOLDER_PATH_FIELD, core: true },
          { text: 'into', field: DESTINATION_PARENT_FIELD },
        ],
        file_delete_folder: [{ text: 'Delete folder', field: FOLDER_PATH_FIELD, core: true }],
        file_restore_folder: [{ text: 'Restore folder', field: 'restoreFolderId', core: true }],
        file_move: [
          { text: 'Move', field: 'moveFileId', core: true },
          { text: 'into', field: MOVE_TARGET_FIELD },
        ],
        file_decompress: [{ text: 'Unzip', field: DECOMPRESS_FILE_FIELD, core: true }],
        file_manage_sharing: [
          { text: 'Set sharing on', field: SHARE_FILE_FIELD, core: true },
          { text: 'to', field: 'shareVisibility' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown' as SubBlockType,
      options: [
        { label: 'List', id: 'file_list' },
        { label: 'Read', id: 'file_read' },
        { label: 'Get Content', id: 'file_get_content' },
        { label: 'Search', id: 'file_search' },
        { label: 'Fetch', id: 'file_fetch' },
        { label: 'Write', id: 'file_write' },
        { label: 'Append', id: 'file_append' },
        { label: 'Compress', id: 'file_compress' },
        { label: 'Decompress', id: 'file_decompress' },
        { label: 'Manage Sharing', id: 'file_manage_sharing' },
        { label: 'Create Folder', id: 'file_create_folder' },
        { label: 'Move Folder', id: 'file_update_folder' },
        { label: 'Delete Folder', id: 'file_delete_folder' },
        { label: 'Restore Folder', id: 'file_restore_folder' },
        { label: 'Move File', id: 'file_move' },
      ],
      value: () => 'file_read',
    },
    {
      id: 'folderSelection',
      title: 'Folder',
      type: 'sim-folder-tree-selector' as SubBlockType,
      resourceType: 'file',
      canonicalParamId: 'folderScopeRef',
      mode: 'basic',
      placeholder: 'Anywhere in the workspace',
      description:
        'Narrows the file options below. Read, get content, and compress also take the whole folder when no file is picked.',
      condition: {
        field: 'operation',
        value: ['file_read', 'file_get_content', 'file_compress', 'file_append'],
      },
    },
    {
      id: 'manualFolderSelection',
      title: 'Folder Path',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'folderScopeRef',
      mode: 'advanced',
      placeholder: '/Reports/Q3%20Results',
      condition: {
        field: 'operation',
        value: ['file_read', 'file_get_content', 'file_compress', 'file_append'],
      },
    },
    {
      id: 'folderIncludeSubfolders',
      title: 'Include Subfolders',
      type: 'switch' as SubBlockType,
      value: () => 'true',
      condition: {
        field: 'operation',
        value: ['file_read', 'file_get_content', 'file_compress', 'file_append'],
      },
    },
    {
      id: 'readFile',
      title: 'Files',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'readFileInput',
      acceptedTypes: '*',
      placeholder: 'Select workspace files',
      multiple: true,
      folderScope: FOLDER_SCOPE,
      mode: 'basic',
      condition: { field: 'operation', value: 'file_read' },
    },
    {
      id: 'readFileId',
      title: 'File ID',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'readFileInput',
      placeholder: 'Workspace file ID or JSON array of IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_read' },
    },
    {
      id: 'getContentFile',
      title: 'Files',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'getContentInput',
      acceptedTypes: '*',
      placeholder: 'Select workspace files',
      multiple: true,
      folderScope: FOLDER_SCOPE,
      mode: 'basic',
      condition: { field: 'operation', value: 'file_get_content' },
    },
    {
      id: 'getContentFileId',
      title: 'File ID',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'getContentInput',
      placeholder: 'Workspace file ID or JSON array of IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_get_content' },
    },
    {
      id: 'mode',
      title: 'Match',
      type: 'dropdown' as SubBlockType,
      options: [
        { label: 'Regular expression', id: 'regex' },
        { label: 'Exact match', id: 'exact' },
      ],
      description:
        'How the query is read. Regular expressions match one line at a time and need at least 3 consecutive literal characters.',
      value: () => 'regex',
      condition: { field: 'operation', value: 'file_search' },
      paramVisibility: 'user-only',
    },
    {
      id: 'query',
      title: 'Query',
      type: 'short-input' as SubBlockType,
      placeholder: 'Pattern to find across workspace files',
      description: 'Search pattern, 3-512 characters. Leave blank for the agent to supply.',
      condition: { field: 'operation', value: 'file_search' },
      required: { field: 'operation', value: 'file_search' },
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'maxResults',
      title: 'Maximum Results',
      type: 'short-input' as SubBlockType,
      placeholder: '50',
      description: 'Hard cap for results returned to the agent (1-200).',
      value: () => '50',
      condition: { field: 'operation', value: 'file_search' },
      required: { field: 'operation', value: 'file_search' },
      mode: 'advanced',
      paramVisibility: 'user-only',
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
      id: 'writeFolderPath',
      title: 'Folder',
      type: 'sim-folder-tree-selector' as SubBlockType,
      resourceType: 'file',
      placeholder: 'Workspace root',
      canonicalParamId: 'writeFolderRef',
      mode: 'basic',
      condition: { field: 'operation', value: 'file_write' },
    },
    {
      id: 'manualWriteFolderPath',
      title: 'Folder Path',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'writeFolderRef',
      mode: 'advanced',
      placeholder: '/Reports/Q3%20Results',
      condition: { field: 'operation', value: 'file_write' },
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
    },
    {
      id: 'writeFile',
      title: 'File',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'writeFileInput',
      acceptedTypes: '*',
      placeholder: 'Store an existing file',
      mode: 'basic',
      condition: { field: 'operation', value: 'file_write' },
    },
    {
      id: 'writeFileId',
      title: 'File',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'writeFileInput',
      placeholder: 'File from an earlier block',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_write' },
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
      id: 'overwrite',
      title: 'Overwrite Existing File',
      type: 'switch' as SubBlockType,
      condition: { field: 'operation', value: 'file_write' },
    },
    {
      id: 'appendFile',
      title: 'File',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'appendFileInput',
      acceptedTypes: '.txt,.md,.json,.csv,.xml,.html,.htm,.yaml,.yml,.log,.rtf',
      placeholder: 'Select or upload a workspace file',
      folderScope: FOLDER_SCOPE,
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
      folderScope: FOLDER_SCOPE,
      mode: 'basic',
      condition: { field: 'operation', value: 'file_compress' },
    },
    {
      id: 'compressFileId',
      title: 'File ID',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'compressInput',
      placeholder: 'Workspace file ID or JSON array of IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_compress' },
    },
    {
      id: 'archiveName',
      title: 'Archive Name',
      type: 'short-input' as SubBlockType,
      placeholder: 'archive.zip (auto-named from source if omitted)',
      condition: { field: 'operation', value: ['file_compress', 'file_compress_folder'] },
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
    {
      id: 'folderPath',
      title: 'Folder',
      type: 'sim-folder-tree-selector' as SubBlockType,
      resourceType: 'file',
      placeholder: 'Select a folder',
      canonicalParamId: 'folderRef',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['file_list', 'file_update_folder', 'file_delete_folder'],
      },
      required: { field: 'operation', value: ['file_update_folder', 'file_delete_folder'] },
    },
    {
      id: 'manualFolderPath',
      title: 'Folder Path',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'folderRef',
      mode: 'advanced',
      placeholder: '/Reports/Q3%20Results',
      condition: {
        field: 'operation',
        value: ['file_list', 'file_update_folder', 'file_delete_folder'],
      },
      required: { field: 'operation', value: ['file_update_folder', 'file_delete_folder'] },
    },
    {
      id: 'createParentPath',
      title: 'Parent Folder',
      type: 'sim-folder-tree-selector' as SubBlockType,
      resourceType: 'file',
      placeholder: 'Workspace root',
      canonicalParamId: 'createParentRef',
      mode: 'basic',
      condition: { field: 'operation', value: 'file_create_folder' },
    },
    {
      id: 'manualCreateParentPath',
      title: 'Parent Folder Path',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'createParentRef',
      mode: 'advanced',
      placeholder: '/Reports',
      condition: { field: 'operation', value: 'file_create_folder' },
    },
    {
      id: 'folderName',
      title: 'Name',
      type: 'short-input' as SubBlockType,
      placeholder: 'Q3 Results',
      condition: { field: 'operation', value: 'file_create_folder' },
      required: { field: 'operation', value: 'file_create_folder' },
    },
    {
      id: 'destinationParentPath',
      title: 'Move Into',
      type: 'sim-folder-tree-selector' as SubBlockType,
      resourceType: 'file',
      placeholder: 'Workspace root',
      canonicalParamId: 'destinationParentRef',
      mode: 'basic',
      condition: { field: 'operation', value: 'file_update_folder' },
    },
    {
      id: 'manualDestinationParentPath',
      title: 'Destination Parent Path',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'destinationParentRef',
      mode: 'advanced',
      placeholder: '/Archive',
      condition: { field: 'operation', value: 'file_update_folder' },
    },
    {
      id: 'folderRecursive',
      title: 'Recursive',
      type: 'switch' as SubBlockType,
      condition: { field: 'operation', value: 'file_list' },
    },
    {
      id: 'folderDepth',
      title: 'Max Depth',
      type: 'short-input' as SubBlockType,
      placeholder: 'Unlimited',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_list' },
    },
    {
      id: 'folderSearch',
      title: 'Search',
      type: 'short-input' as SubBlockType,
      placeholder: 'Match folder and file names',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_list' },
    },
    {
      id: 'folderLimit',
      title: 'Limit',
      type: 'short-input' as SubBlockType,
      placeholder: '200',
      mode: 'advanced',
      condition: { field: 'operation', value: 'file_list' },
    },
    {
      id: 'deleteFolderRecursive',
      title: 'Delete Contents',
      type: 'switch' as SubBlockType,
      condition: { field: 'operation', value: 'file_delete_folder' },
    },
    {
      id: 'moveFileId',
      title: 'File ID',
      type: 'short-input' as SubBlockType,
      placeholder: 'Canonical workspace file ID',
      condition: { field: 'operation', value: 'file_move' },
      required: { field: 'operation', value: 'file_move' },
    },
    {
      id: 'moveTargetFolderPath',
      title: 'Move Into',
      type: 'sim-folder-tree-selector' as SubBlockType,
      resourceType: 'file',
      placeholder: 'Workspace root',
      canonicalParamId: 'moveTargetRef',
      mode: 'basic',
      condition: { field: 'operation', value: 'file_move' },
    },
    {
      id: 'manualMoveTargetFolderPath',
      title: 'Destination Folder Path',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'moveTargetRef',
      mode: 'advanced',
      placeholder: '/Reports',
      condition: { field: 'operation', value: 'file_move' },
    },
    {
      id: 'restoreFolderId',
      title: 'Folder ID',
      type: 'short-input' as SubBlockType,
      placeholder: 'ID of the archived folder',
      condition: { field: 'operation', value: 'file_restore_folder' },
      required: { field: 'operation', value: 'file_restore_folder' },
    },
  ],
  tools: {
    access: [
      'file_read',
      'file_get_content',
      'file_search',
      'file_fetch',
      'file_write',
      'file_append',
      'file_compress',
      'file_decompress',
      'file_manage_sharing',
      'file_list',
      'file_create_folder',
      'file_update_folder',
      'file_delete_folder',
      'file_restore_folder',
      'file_move',
    ],
    config: {
      tool: (params) => params.operation || 'file_read',
      params: (params) => {
        const operation = params.operation || 'file_read'

        if (operation === 'file_search') {
          const maxResultsInput =
            params.maxResults == null || params.maxResults === '' ? 50 : params.maxResults
          const maxResults = Number(maxResultsInput)
          if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 200) {
            throw new Error('Maximum Results must be an integer between 1 and 200')
          }
          return {
            query: params.query,
            mode: params.mode === 'exact' ? 'exact' : 'regex',
            maxResults,
          }
        }

        if (operation === 'file_write') {
          // Writing stores one file, so the single form.
          const fileInput = normalizeFileInput(params.writeFileInput, { single: true })
          // The contract counts any defined `content` as "text was provided", and
          // an untouched Content box serializes as an empty string — so sending it
          // unconditionally would make every file write collide with its own empty
          // text box. The selected file is what disambiguates: with one present,
          // an empty Content box means "not used" and is dropped, while a
          // non-empty one is still forwarded so the contract can report that both
          // were filled. With no file, `content` always goes through, which keeps
          // writing a deliberately empty text file possible.
          const contentText = typeof params.content === 'string' ? params.content : undefined
          const omitContent = Boolean(fileInput) && !contentText
          return {
            fileName: params.fileName,
            folderPath: optionalText(params.writeFolderRef),
            ...(omitContent ? {} : { content: params.content }),
            ...(fileInput ? { fileInput } : {}),
            contentType: params.contentType,
            overwrite: params.overwrite === true || params.overwrite === 'true',
            workspaceId: params._context?.workspaceId,
          }
        }

        if (operation === 'file_list') {
          return {
            path: optionalText(params.folderRef),
            recursive: switchValue(params.folderRecursive),
            depth: parseOptionalNumberInput(params.folderDepth, 'Max Depth', {
              integer: true,
              min: 1,
            }),
            search: optionalText(params.folderSearch),
            limit: parseOptionalNumberInput(params.folderLimit, 'Limit', {
              integer: true,
              min: 1,
            }),
            workspaceId: params._context?.workspaceId,
          }
        }

        if (operation === 'file_create_folder') {
          /*
           * A folder is created by naming it inside a parent, not by spelling
           * its whole path. The parent is pickable and the name is not, so the
           * path is composed here — percent-encoding the typed name, because the
           * tool takes a canonical path.
           */
          const name = optionalText(params.folderName)
          const parentPrefix = folderPathPrefix(optionalText(params.createParentRef))
          return {
            path: name ? `${parentPrefix}/${encodeFolderPathSegment(name)}` : undefined,
            workspaceId: params._context?.workspaceId,
          }
        }

        if (operation === 'file_update_folder') {
          /*
           * The tool takes the full path the folder will HAVE, which by
           * definition does not exist yet and so cannot be picked. It is
           * composed from a destination parent plus the folder's own name,
           * carried from the source path's last segment. An unset parent means
           * the workspace root. Renaming is not a move and is not offered here.
           */
          const sourcePath = optionalText(params.folderRef)
          const segment = sourcePath?.split('/').pop()
          const parentPrefix = folderPathPrefix(optionalText(params.destinationParentRef))

          return {
            path: sourcePath,
            destinationPath: segment ? `${parentPrefix}/${segment}` : undefined,
            workspaceId: params._context?.workspaceId,
          }
        }

        if (operation === 'file_delete_folder') {
          return {
            path: optionalText(params.folderRef),
            recursive: switchValue(params.deleteFolderRecursive),
            workspaceId: params._context?.workspaceId,
          }
        }

        if (operation === 'file_move') {
          return {
            fileId: optionalText(params.moveFileId),
            folderPath: optionalText(params.moveTargetRef),
            workspaceId: params._context?.workspaceId,
          }
        }

        if (operation === 'file_restore_folder') {
          return {
            folderId: optionalText(params.restoreFolderId),
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
            /*
             * Prefer the picked file's id over its name. The reference resolver
             * accepts a canonical id, and a bare name is ambiguous once the same
             * one exists in more than one folder — so discarding the identity
             * the picker already held is what let a pick resolve to another
             * file.
             */
            const pickedId = typeof file?.id === 'string' ? file.id : ''
            fileName = pickedId || ((file?.name as string) ?? '')
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
          return {
            ...fileFamilyInput(params, 'compress', params.compressInput),
            archiveName: optionalText(params.archiveName),
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

          const allowedEmails =
            typeof params.shareAllowedEmails === 'string'
              ? params.shareAllowedEmails
                  .split(/[\n,]/)
                  .map((email) => email.trim())
                  .filter(Boolean)
              : undefined

          const visibility = (params.shareVisibility as string) || 'public'
          const isActive = visibility !== 'private'
          const shareParams = {
            isActive,
            // When disabling, leave authType unset so the stored access mode is preserved.
            authType: isActive ? visibility : undefined,
            password: params.sharePassword,
            allowedEmails,
            workspaceId: params._context?.workspaceId,
          }

          // Canonical IDs (advanced mode or upstream references) resolve directly.
          const fileIds = parseReadFileIds(shareInput)
          if (fileIds) {
            if (Array.isArray(fileIds) && fileIds.length > 1) {
              throw new Error('Manage Sharing accepts a single file at a time')
            }
            return { fileId: Array.isArray(fileIds) ? fileIds[0] : fileIds, ...shareParams }
          }

          // The basic picker yields a file object; it carries an id only sometimes,
          // so prefer the id when present and otherwise pass the object for the
          // route to resolve via its storage key.
          const normalized = normalizeFileInput(shareInput, { single: true })
          const file = normalized as Record<string, unknown> | null
          if (!file) {
            throw new Error('Could not determine the file to share')
          }
          if (typeof file.id === 'string' && file.id) {
            return { fileId: file.id, ...shareParams }
          }
          return { fileInput: normalized, ...shareParams }
        }

        if (operation === 'file_fetch') {
          const fileUrl = resolveHttpFileUrl(params.fileUrl)

          return {
            fileUrl,
            headers: params.headers,
            workspaceId: params._context?.workspaceId,
            workflowId: params._context?.workflowId,
            executionId: params._context?.executionId,
          }
        }

        if (operation === 'file_get_content') {
          return fileFamilyInput(params, 'get content', params.getContentInput)
        }

        return fileFamilyInput(params, 'read', params.readFileInput)
      },
    },
  },
  inputs: {
    operation: {
      type: 'string',
      description: 'Operation to perform (read, search, get content, fetch, write, or append)',
    },
    query: { type: 'string', description: 'Workspace file search query' },
    mode: {
      type: 'string',
      description: 'How the search query is read: a regular expression (default) or an exact match',
    },
    maxResults: { type: 'number', description: 'Hard maximum search results (1-200)' },
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
    writeFileInput: {
      type: 'json',
      description: 'An existing file to store in the workspace, instead of text content',
    },
    contentType: { type: 'string', description: 'MIME content type for write' },
    overwrite: {
      type: 'boolean',
      description: 'Replace an existing file with the same name instead of creating a copy (write)',
    },
    appendFileInput: { type: 'json', description: 'File to append to' },
    appendContent: { type: 'string', description: 'Content to append to file' },
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
    writeFolderRef: {
      type: 'string',
      description: 'Folder to create the file in (write)',
    },
    folderRef: {
      type: 'string',
      description: 'Folder to act on (list folders, move folder, delete folder)',
    },
    createParentRef: {
      type: 'string',
      description: 'Folder the new folder is created inside (create folder)',
    },
    folderName: {
      type: 'string',
      description: 'Name of the folder to create (create folder)',
    },
    destinationParentRef: {
      type: 'string',
      description: 'Folder the moved folder is placed inside (move folder)',
    },
    moveTargetRef: {
      type: 'string',
      description: 'Folder the file is moved into (move file)',
    },
    moveFileId: {
      type: 'string',
      description: 'Canonical ID of the file to move (move file)',
    },
    restoreFolderId: {
      type: 'string',
      description: 'ID of the deleted folder to restore (restore folder)',
    },
    folderRecursive: {
      type: 'boolean',
      description: 'Walk the whole subtree rather than direct children (list folders)',
    },
    folderDepth: {
      type: 'number',
      description: 'Deepest level to include when recursive (list folders)',
    },
    folderSearch: {
      type: 'string',
      description: 'Substring match against folder names (list folders)',
    },
    deleteFolderRecursive: {
      type: 'boolean',
      description: 'Also delete nested folders and files (delete folder)',
    },
    compressInput: {
      type: 'json',
      description: 'Selected workspace files or canonical file IDs to compress',
    },
    folderIncludeSubfolders: {
      type: 'boolean',
      description:
        'Whether the folder scope reaches into nested folders (read, get content, compress)',
    },
    folderScopeRef: {
      type: 'string',
      description:
        'Folder the operation is scoped to, expanded at run time when no file is picked (read, get content, compress)',
    },
    folderLimit: {
      type: 'number',
      description: 'Most entries to return (list)',
    },
  },
  outputs: {
    files: {
      type: 'file[]',
      description:
        'Workspace file objects with share status (read), fetched file objects (fetch), the compressed archive (compress), or extracted files (decompress)',
    },
    contents: {
      type: 'array',
      description: 'Array of file text contents, one entry per file (get content)',
    },
    results: {
      type: 'array',
      description: 'Matching lines as objects with fileId, lineNumber, and text fields (search)',
    },
    count: { type: 'number', description: 'Returned matching line count (search)' },
    truncated: {
      type: 'boolean',
      description:
        'Whether results were cut short by a cap: more matches exist (search), or more entries exist (list)',
    },
    complete: {
      type: 'boolean',
      description: 'Whether all current workspace file revisions are indexed without failures',
    },
    indexStatus: {
      type: 'json',
      description:
        'Workspace search-index coverage counts: readyFiles, pendingFiles, failedFiles, skippedFiles, and partialFiles',
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
    entries: {
      type: 'array',
      description:
        'What the folder holds, each with kind "folder" or "file", a name, and its depth below the listed folder (list)',
    },
    folder: {
      type: 'json',
      description: 'The affected folder (create, move, delete, and restore folder)',
    },
    path: {
      type: 'string',
      description: 'The folder that was listed or deleted (list and delete folder)',
    },
    previousPath: {
      type: 'string',
      description: 'The path the folder had before it moved (move folder)',
    },
    deleted: {
      type: 'boolean',
      description: 'Whether the folder was deleted (delete folder)',
    },
    deletedItems: {
      type: 'json',
      description: 'Counts of folders and files deleted alongside the folder (delete folder)',
    },
    fileId: {
      type: 'string',
      description: 'The file that was moved (move file)',
    },
    folderPath: {
      type: 'string',
      description: 'The folder the file now lives in (move file)',
    },
    restoredItems: {
      type: 'json',
      description: 'Counts of folders and files restored alongside the folder (restore folder)',
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
