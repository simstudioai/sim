import { vi } from 'vitest'

type ContentKind = 'image' | 'document' | 'audio' | 'video'

/** Structural stand-in for `StorageContext` from `@/lib/uploads`. */
type MockStorageContext =
  | 'knowledge-base'
  | 'chat'
  | 'copilot'
  | 'execution'
  | 'workspace'
  | 'mothership'
  | 'profile-pictures'
  | 'og-images'
  | 'workspace-logos'
  | 'organization-logos'
  | 'logs'

/** Structural stand-in for `RawFileInput`. */
interface MockRawFileInput {
  id?: string
  key?: string
  path?: string
  url?: string
  name: string
  size: number
  type?: string
  uploadedAt?: string | Date
  expiresAt?: string | Date
  context?: string
  base64?: string
  [field: string]: unknown
}

/** Structural stand-in for `UserFile` from `@/executor/types`. */
interface MockUserFile {
  id: string
  name: string
  url: string
  size: number
  type: string
  key: string
  context?: string
  base64?: string
  [field: string]: unknown
}

/** Minimal logger surface the conversion helpers write to. */
interface MockFileUtilsLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

/** Faithful copy of the real mapping table. */
const MIME_TYPE_MAPPING: Record<string, 'image' | 'document' | 'audio' | 'video'> = {
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'image',
  'image/bmp': 'image',
  'image/tiff': 'image',
  'image/heic': 'image',
  'image/heif': 'image',
  'image/avif': 'image',
  'image/x-icon': 'image',
  'image/vnd.microsoft.icon': 'image',
  'application/pdf': 'document',
  'text/plain': 'document',
  'text/csv': 'document',
  'application/json': 'document',
  'application/xml': 'document',
  'text/xml': 'document',
  'text/html': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document',
  'application/msword': 'document',
  'application/vnd.ms-excel': 'document',
  'application/vnd.ms-powerpoint': 'document',
  'text/markdown': 'document',
  'application/rtf': 'document',
  'audio/mpeg': 'audio',
  'audio/mp3': 'audio',
  'audio/mp4': 'audio',
  'audio/x-m4a': 'audio',
  'audio/m4a': 'audio',
  'audio/wav': 'audio',
  'audio/wave': 'audio',
  'audio/x-wav': 'audio',
  'audio/webm': 'audio',
  'audio/ogg': 'audio',
  'audio/vorbis': 'audio',
  'audio/flac': 'audio',
  'audio/x-flac': 'audio',
  'audio/aac': 'audio',
  'audio/x-aac': 'audio',
  'audio/opus': 'audio',
  'video/mp4': 'video',
  'video/mpeg': 'video',
  'video/quicktime': 'video',
  'video/x-quicktime': 'video',
  'video/x-msvideo': 'video',
  'video/avi': 'video',
  'video/x-matroska': 'video',
  'video/webm': 'video',
}

/** Faithful copy of the real extension table. */
const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  md: 'text/markdown',
  yaml: 'application/x-yaml',
  yml: 'application/x-yaml',
  rtf: 'application/rtf',
  zip: 'application/zip',
  gz: 'application/gzip',
  py: 'text/x-python',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  jsx: 'text/javascript',
  go: 'text/x-go',
  rs: 'text/x-rust',
  java: 'text/x-java',
  kt: 'text/x-kotlin',
  c: 'text/x-c',
  cpp: 'text/x-c++',
  h: 'text/x-c',
  hpp: 'text/x-c++',
  cs: 'text/x-csharp',
  rb: 'text/x-ruby',
  php: 'text/x-php',
  swift: 'text/x-swift',
  sh: 'text/x-shellscript',
  bash: 'text/x-shellscript',
  zsh: 'text/x-shellscript',
  r: 'text/x-r',
  sql: 'text/x-sql',
  scala: 'text/x-scala',
  lua: 'text/x-lua',
  pl: 'text/x-perl',
  toml: 'text/x-toml',
  ini: 'text/plain',
  cfg: 'text/plain',
  conf: 'text/plain',
  env: 'text/plain',
  log: 'text/plain',
  makefile: 'text/x-makefile',
  dockerfile: 'text/x-dockerfile',
  css: 'text/css',
  scss: 'text/x-scss',
  less: 'text/x-less',
  graphql: 'text/x-graphql',
  gql: 'text/x-graphql',
  proto: 'text/x-protobuf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  opus: 'audio/opus',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
}

/** Faithful copy of the real reverse table. */
const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'text/html': 'html',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'text/markdown': 'md',
  'application/rtf': 'rtf',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/vorbis': 'ogg',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/aac': 'aac',
  'audio/x-aac': 'aac',
  'audio/opus': 'opus',
  'video/mp4': 'mp4',
  'video/mpeg': 'mpg',
  'video/quicktime': 'mov',
  'video/x-quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'video/avi': 'avi',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/gzip': 'gz',
}

const MODEL_SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
])
const GENERATED_DOCUMENT_SOURCE_TYPES = new Set<string>([
  'text/x-docxjs',
  'text/x-pptxgenjs',
  'text/x-pdflibjs',
  'text/x-python-pdf',
  'text/x-python-xlsx',
])
const RENDERABLE_DOCUMENT_EXTENSIONS = new Set(['pdf', 'docx', 'pptx', 'xlsx'])
const ARCHIVE_EXTENSIONS = new Set<string>(['zip'])
const GENERIC_MIME_TYPE = 'application/octet-stream'
const GENERIC_MIME_TYPES = new Set([GENERIC_MIME_TYPE, 'binary/octet-stream'])
const DUAL_CONTAINER_MIME: Record<string, string> = { webm: 'video/webm' }
const MEDIA_FALLBACK_MIME = { audio: 'audio/mpeg', video: 'video/mp4' } as const
const PUBLIC_STORAGE_CONTEXTS = new Set<string>([
  'profile-pictures',
  'og-images',
  'workspace-logos',
  'organization-logos',
])
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  return lastDot !== -1 ? filename.slice(lastDot + 1).toLowerCase() : ''
}

function getContentType(mimeType: string): ContentKind | null {
  return MIME_TYPE_MAPPING[mimeType.toLowerCase()] || null
}

function createFileContentFromBase64(base64: string, mimeType: string) {
  if (mimeType.toLowerCase() === 'image/svg+xml') {
    return {
      type: 'document' as const,
      source: { type: 'base64' as const, media_type: 'text/xml', data: base64 },
    }
  }
  const contentType = getContentType(mimeType)
  if (!contentType) return null
  if (contentType === 'image' && !MODEL_SUPPORTED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase())) {
    return null
  }
  return {
    type: contentType,
    source: { type: 'base64' as const, media_type: mimeType, data: base64 },
  }
}

function isGeneratedDocumentSourceType(contentType: string | undefined | null): boolean {
  return contentType ? GENERATED_DOCUMENT_SOURCE_TYPES.has(contentType) : false
}

function isRenderableDocumentName(fileName: string): boolean {
  return RENDERABLE_DOCUMENT_EXTENSIONS.has(getFileExtension(fileName))
}

function getMimeTypeFromExtension(extension: string): string {
  return EXTENSION_TO_MIME[extension.toLowerCase()] || GENERIC_MIME_TYPE
}

function identifiesFormat(declared: string | undefined): declared is string {
  return declared !== undefined && declared !== '' && !GENERIC_MIME_TYPES.has(declared)
}

function resolveEffectiveMimeType(
  declaredType: string | null | undefined,
  filename: string
): string {
  const declared = declaredType?.trim()
  if (identifiesFormat(declared)) return declared
  const extension = getFileExtension(filename)
  return DUAL_CONTAINER_MIME[extension] ?? getMimeTypeFromExtension(extension)
}

function resolveFileType(
  file: { type: string; name: string },
  options?: { preserveOctetStream?: boolean }
): string {
  const browserType = file.type?.trim()
  if (browserType && options?.preserveOctetStream) return browserType
  if (identifiesFormat(browserType)) return browserType
  return getMimeTypeFromExtension(getFileExtension(file.name))
}

function getExtensionFromMimeType(mimeType: string): string | null {
  return MIME_TO_EXTENSION[mimeType.split(';')[0].trim().toLowerCase()] || null
}

function extractStorageKey(filePath: string): string {
  let pathWithoutQuery = filePath.split('?')[0]
  try {
    if (pathWithoutQuery.startsWith('http://') || pathWithoutQuery.startsWith('https://')) {
      pathWithoutQuery = new URL(pathWithoutQuery).pathname
    }
  } catch {
    /** Unparseable URL: keep the original path, like the real helper. */
  }
  if (pathWithoutQuery.startsWith('/api/files/serve/')) {
    let key = decodeURIComponent(pathWithoutQuery.substring('/api/files/serve/'.length))
    if (key.startsWith('s3/')) key = key.substring(3)
    else if (key.startsWith('blob/')) key = key.substring(5)
    else if (key.startsWith('gcs/')) key = key.substring(4)
    return key
  }
  return pathWithoutQuery
}

function isInternalFileUrl(fileUrl: string): boolean {
  if (typeof fileUrl !== 'string') return false
  let path = fileUrl
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(path)
  if (scheme) path = path.slice(scheme[0].length)
  path = path.split(/[?#]/, 1)[0]
  return path.startsWith('/api/files/serve/')
}

function tryInferContextFromKey(key: string): MockStorageContext | null {
  if (!key) return null
  if (key.startsWith('kb/') || key.startsWith('knowledge-base/')) return 'knowledge-base'
  if (key.startsWith('chat/')) return 'chat'
  if (key.startsWith('copilot/')) return 'copilot'
  if (key.startsWith('execution/')) return 'execution'
  if (key.startsWith('workspace/')) return 'workspace'
  if (key.startsWith('assistant/')) return 'mothership'
  if (key.startsWith('profile-pictures/')) return 'profile-pictures'
  if (key.startsWith('og-images/')) return 'og-images'
  if (key.startsWith('workspace-logos/')) return 'workspace-logos'
  if (key.startsWith('organization-logos/')) return 'organization-logos'
  if (key.startsWith('logs/')) return 'logs'
  return null
}

function inferContextFromKey(key: string): MockStorageContext {
  const context = tryInferContextFromKey(key)
  if (!context) {
    throw new Error(
      key
        ? `File key must start with a context prefix (kb/, knowledge-base/, chat/, copilot/, execution/, workspace/, profile-pictures/, og-images/, workspace-logos/, organization-logos/, or logs/). Got: ${key}`
        : 'Cannot infer context from empty key'
    )
  }
  return context
}

function isPublicStorageContext(context: string): boolean {
  return PUBLIC_STORAGE_CONTEXTS.has(context)
}

function isUrlLike(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')
}

function isCompleteUserFile(file: MockRawFileInput): file is MockRawFileInput & MockUserFile {
  return (
    typeof file.id === 'string' &&
    typeof file.name === 'string' &&
    typeof file.url === 'string' &&
    typeof file.size === 'number' &&
    typeof file.type === 'string' &&
    typeof file.key === 'string'
  )
}

function resolveStorageKeyFromRawFile(file: MockRawFileInput): string | null {
  if (file.key) return file.key
  if (file.path) {
    if (isUrlLike(file.path))
      return isInternalFileUrl(file.path) ? extractStorageKey(file.path) : null
    return file.path
  }
  if (file.url) return isInternalFileUrl(file.url) ? extractStorageKey(file.url) : null
  return null
}

function resolveInternalUrl(file: MockRawFileInput): string {
  if (file.url && isInternalFileUrl(file.url)) return file.url
  if (file.path && isInternalFileUrl(file.path)) return file.path
  return ''
}

function convertToUserFile(file: MockRawFileInput): MockUserFile | null {
  if (isCompleteUserFile(file)) {
    const { providerFileId: _id, providerFileUri: _uri, remoteUrl: _remote, ...rest } = file
    return {
      ...rest,
      url: resolveInternalUrl(file) || file.url,
    } as MockUserFile
  }
  const storageKey = resolveStorageKeyFromRawFile(file)
  if (!storageKey) return null
  return {
    id: file.id || `file-${Date.now()}`,
    name: file.name,
    url: resolveInternalUrl(file),
    size: file.size,
    type: file.type || 'application/octet-stream',
    key: storageKey,
    context: file.context,
    base64: file.base64,
  }
}

function extractWorkspaceIdFromExecutionKey(key: string): string | null {
  const segments = key.split('/')
  if (segments[0] === 'execution' && segments.length >= 5) {
    const workspaceId = segments[1]
    if (workspaceId && isUuid(workspaceId)) return workspaceId
  }
  return null
}

/**
 * Controllable mock functions for `@/lib/uploads/utils/file-utils`.
 *
 * The real module is pure, so every default is a faithful port of the real helper
 * (tables included). Override per test only where the unit under test must see a
 * specific classification. Two defaults are simplified and documented:
 * `validateKnowledgeBaseFile` checks size only, and the conversion helpers
 * (`processFilesToUserFiles`, `processSingleFileToUserFile`) do not log.
 *
 * @example
 * ```ts
 * import { fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
 *
 * fileUtilsMockFns.mockProcessFilesToUserFiles.mockReturnValue([userFile])
 * ```
 */
export const fileUtilsMockFns = {
  mockGetContentType: vi.fn(getContentType),
  mockIsSupportedFileType: vi.fn((mimeType: string) => mimeType.toLowerCase() in MIME_TYPE_MAPPING),
  mockIsImageFileType: vi.fn((mimeType: string) => getContentType(mimeType) === 'image'),
  mockIsAudioFileType: vi.fn((mimeType: string) => getContentType(mimeType) === 'audio'),
  mockIsVideoFileType: vi.fn((mimeType: string) => getContentType(mimeType) === 'video'),
  mockBufferToBase64: vi.fn((buffer: Buffer) => buffer.toString('base64')),
  mockCreateFileContent: vi.fn((fileBuffer: Buffer, mimeType: string) =>
    createFileContentFromBase64(fileBuffer.toString('base64'), mimeType)
  ),
  mockCreateFileContentFromBase64: vi.fn(createFileContentFromBase64),
  mockGetFileExtension: vi.fn(getFileExtension),
  mockIsMarkdownFile: vi.fn((file: { type?: string | null; name: string }) => {
    if (file.type === 'text/markdown') return true
    const ext = getFileExtension(file.name)
    return ext === 'md' || ext === 'markdown'
  }),
  mockIsGeneratedDocumentSourceType: vi.fn(isGeneratedDocumentSourceType),
  mockIsRenderableDocumentName: vi.fn(isRenderableDocumentName),
  mockNeedsRenderedArtifact: vi.fn((contentType: string | null | undefined, fileName: string) =>
    contentType ? isGeneratedDocumentSourceType(contentType) : isRenderableDocumentName(fileName)
  ),
  mockIsArchiveFileName: vi.fn((filename: string) =>
    ARCHIVE_EXTENSIONS.has(getFileExtension(filename))
  ),
  mockBuildArchiveExtractGuidance: vi.fn(
    (name: string) =>
      `"${name}" is a .zip archive — its contents can't be read directly. Mount it into the chat sandbox with run_code (inputs.files: [{"path": "uploads/${name}", "sandboxPath": "/tmp/${name}"}]) and unzip it there; persist anything worth keeping with \`files upload @<path>\`.`
  ),
  mockGetMimeTypeFromExtension: vi.fn(getMimeTypeFromExtension),
  mockResolveEffectiveMimeType: vi.fn(resolveEffectiveMimeType),
  mockResolveMediaMimeType: vi.fn(
    (declaredType: string | null | undefined, filename: string, kind: 'audio' | 'video') => {
      const resolved = resolveEffectiveMimeType(declaredType, filename)
      const [type, subtype] = resolved.split('/')
      if (type === kind) return resolved
      if (type === 'audio' || type === 'video') return `${kind}/${subtype}`
      return MEDIA_FALLBACK_MIME[kind]
    }
  ),
  mockResolveFileType: vi.fn(resolveFileType),
  mockGetFileContentType: vi.fn((file: { type: string; name: string }) =>
    resolveFileType(file, { preserveOctetStream: true })
  ),
  mockIsAbortError: vi.fn(
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      String((error as { name?: unknown }).name) === 'AbortError'
  ),
  mockIsNetworkError: vi.fn((error: unknown) => {
    if (!(error instanceof Error)) return false
    const message = error.message.toLowerCase()
    return (
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('connection') ||
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('econnreset')
    )
  }),
  mockGetExtensionFromMimeType: vi.fn(getExtensionFromMimeType),
  mockEnsureFileNameExtension: vi.fn((fileName: string, contentType: string | null | undefined) => {
    if (!contentType || /^[a-z0-9]+$/.test(getFileExtension(fileName))) return fileName
    const extension = getExtensionFromMimeType(contentType)
    return extension ? `${fileName}.${extension}` : fileName
  }),
  mockFormatFileSize: vi.fn(
    (bytes: number, options?: { includeBytes?: boolean; precision?: number }) => {
      if (bytes === 0) return '0 Bytes'
      const k = 1024
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
      const precision = options?.precision ?? 1
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      if (i === 0 && !(options?.includeBytes ?? false)) return '0 Bytes'
      return `${Number.parseFloat((bytes / k ** i).toFixed(precision))} ${sizes[i]}`
    }
  ),
  mockValidateKnowledgeBaseFile: vi.fn(
    (file: { size: number; name: string }, maxSizeBytes: number = 100 * 1024 * 1024) => {
      if (file.size > maxSizeBytes) {
        const maxSizeMB = Math.round(maxSizeBytes / (1024 * 1024))
        return `File "${file.name}" is too large. Maximum size is ${maxSizeMB}MB.`
      }
      return null
    }
  ),
  mockExtractStorageKey: vi.fn(extractStorageKey),
  mockIsInternalFileUrl: vi.fn(isInternalFileUrl),
  mockInferContextFromKey: vi.fn(inferContextFromKey),
  mockTryInferContextFromKey: vi.fn(tryInferContextFromKey),
  mockIsPublicStorageContext: vi.fn(isPublicStorageContext),
  mockResolveTrustedFileContext: vi.fn((key: string, context?: string): string => {
    try {
      return inferContextFromKey(key)
    } catch (error) {
      if (context && !isPublicStorageContext(context)) return context
      throw error
    }
  }),
  mockParseInternalFileUrl: vi.fn((fileUrl: string) => {
    const key = extractStorageKey(fileUrl)
    if (!key) throw new Error('Could not extract storage key from internal file URL')
    const url = new URL(fileUrl.startsWith('http') ? fileUrl : `http://localhost${fileUrl}`)
    const context = url.searchParams.get('context') || inferContextFromKey(key)
    return { key, context }
  }),
  mockResolveHttpsUrlFromFileInput: vi.fn((fileInput: unknown): string | null => {
    if (!fileInput || typeof fileInput !== 'object') return null
    const record = fileInput as Record<string, unknown>
    const url =
      typeof record.url === 'string'
        ? record.url.trim()
        : typeof record.path === 'string'
          ? record.path.trim()
          : ''
    return url?.startsWith('https://') ? url : null
  }),
  mockProcessSingleFileToUserFile: vi.fn(
    (file: MockRawFileInput, _requestId: string, _logger?: MockFileUtilsLogger): MockUserFile => {
      if (Array.isArray(file)) {
        throw new Error(
          `Expected a single file but received an array with ${file.length} file(s). Use a file input that accepts multiple files, or select a specific file from the array (e.g., {{block.files[0]}}).`
        )
      }
      const userFile = convertToUserFile(file)
      if (!userFile) throw new Error(`File has no storage key: ${file.name || 'unknown'}`)
      return userFile
    }
  ),
  mockProcessFilesToUserFiles: vi.fn(
    (
      files: MockRawFileInput | MockRawFileInput[],
      _requestId: string,
      _logger?: MockFileUtilsLogger
    ): MockUserFile[] => {
      const filesArray = Array.isArray(files) ? files : [files]
      const userFiles: MockUserFile[] = []
      for (const file of filesArray) {
        if (Array.isArray(file)) continue
        const userFile = convertToUserFile(file)
        if (userFile) userFiles.push(userFile)
      }
      return userFiles
    }
  ),
  mockSanitizeFilenameForMetadata: vi.fn(
    (filename: string) =>
      filename
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/["\\]/g, '')
        .replace(/\s+/g, ' ')
        .trim() || 'file'
  ),
  mockSanitizeStorageMetadata: vi.fn((metadata: Record<string, string>, maxLength: number) => {
    const sanitized: Record<string, string> = {}
    for (const [key, value] of Object.entries(metadata)) {
      const sanitizedValue = String(value)
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/["\\]/g, '')
        .substring(0, maxLength)
      if (sanitizedValue) sanitized[key] = sanitizedValue
    }
    return sanitized
  }),
  mockSanitizeFileKey: vi.fn((key: string) => {
    if (!key.includes('/')) {
      throw new Error('File key must include a context prefix (e.g., kb/, workspace/, execution/)')
    }
    const segments = key.split('/')
    return segments
      .map((segment, index) => {
        if (segment === '..' || segment === '.') {
          throw new Error('Path traversal detected in file key')
        }
        return index === segments.length - 1
          ? segment.replace(/[^a-zA-Z0-9.-]/g, '_')
          : segment.replace(/[^a-zA-Z0-9-]/g, '_')
      })
      .join('/')
  }),
  mockExtractCleanFilename: vi.fn((urlOrPath: string) => {
    const withoutQuery = urlOrPath.split('?')[0]
    try {
      const url = new URL(
        withoutQuery.startsWith('http') ? withoutQuery : `http://localhost${withoutQuery}`
      )
      return decodeURIComponent(url.pathname.split('/').pop() || 'unknown')
    } catch {
      return decodeURIComponent(withoutQuery.split('/').pop() || 'unknown')
    }
  }),
  mockExtractWorkspaceIdFromExecutionKey: vi.fn(extractWorkspaceIdFromExecutionKey),
  mockExtractWorkspaceIdFromStorageKey: vi.fn((key: string) => {
    const segments = key.split('/')
    if (segments[0] === 'workspace' && segments.length >= 3) {
      const workspaceId = segments[1]
      return workspaceId && isUuid(workspaceId) ? workspaceId : null
    }
    return extractWorkspaceIdFromExecutionKey(key)
  }),
  mockGetViewerUrl: vi.fn((fileKey: string, workspaceId?: string) => {
    const resolvedWorkspaceId = workspaceId || extractWorkspaceIdFromExecutionKey(fileKey)
    return resolvedWorkspaceId ? `/workspace/${resolvedWorkspaceId}/files/${fileKey}` : null
  }),
}

/**
 * Static mock module for `@/lib/uploads/utils/file-utils`. Constants are the real values.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)
 * ```
 */
export const fileUtilsMock = {
  MIME_TYPE_MAPPING,
  MODEL_SUPPORTED_IMAGE_MIME_TYPES,
  GENERATED_DOCUMENT_SOURCE_TYPES,
  MAX_TEXT_EXTRACTION_BYTES: 25 * 1024 * 1024,
  MAX_RENDERED_DOCUMENT_BYTES: 50 * 1024 * 1024,
  getContentType: fileUtilsMockFns.mockGetContentType,
  isSupportedFileType: fileUtilsMockFns.mockIsSupportedFileType,
  isImageFileType: fileUtilsMockFns.mockIsImageFileType,
  isAudioFileType: fileUtilsMockFns.mockIsAudioFileType,
  isVideoFileType: fileUtilsMockFns.mockIsVideoFileType,
  bufferToBase64: fileUtilsMockFns.mockBufferToBase64,
  createFileContent: fileUtilsMockFns.mockCreateFileContent,
  createFileContentFromBase64: fileUtilsMockFns.mockCreateFileContentFromBase64,
  getFileExtension: fileUtilsMockFns.mockGetFileExtension,
  isMarkdownFile: fileUtilsMockFns.mockIsMarkdownFile,
  isGeneratedDocumentSourceType: fileUtilsMockFns.mockIsGeneratedDocumentSourceType,
  isRenderableDocumentName: fileUtilsMockFns.mockIsRenderableDocumentName,
  needsRenderedArtifact: fileUtilsMockFns.mockNeedsRenderedArtifact,
  isArchiveFileName: fileUtilsMockFns.mockIsArchiveFileName,
  buildArchiveExtractGuidance: fileUtilsMockFns.mockBuildArchiveExtractGuidance,
  getMimeTypeFromExtension: fileUtilsMockFns.mockGetMimeTypeFromExtension,
  resolveEffectiveMimeType: fileUtilsMockFns.mockResolveEffectiveMimeType,
  resolveMediaMimeType: fileUtilsMockFns.mockResolveMediaMimeType,
  resolveFileType: fileUtilsMockFns.mockResolveFileType,
  getFileContentType: fileUtilsMockFns.mockGetFileContentType,
  isAbortError: fileUtilsMockFns.mockIsAbortError,
  isNetworkError: fileUtilsMockFns.mockIsNetworkError,
  getExtensionFromMimeType: fileUtilsMockFns.mockGetExtensionFromMimeType,
  ensureFileNameExtension: fileUtilsMockFns.mockEnsureFileNameExtension,
  formatFileSize: fileUtilsMockFns.mockFormatFileSize,
  validateKnowledgeBaseFile: fileUtilsMockFns.mockValidateKnowledgeBaseFile,
  extractStorageKey: fileUtilsMockFns.mockExtractStorageKey,
  isInternalFileUrl: fileUtilsMockFns.mockIsInternalFileUrl,
  inferContextFromKey: fileUtilsMockFns.mockInferContextFromKey,
  tryInferContextFromKey: fileUtilsMockFns.mockTryInferContextFromKey,
  isPublicStorageContext: fileUtilsMockFns.mockIsPublicStorageContext,
  resolveTrustedFileContext: fileUtilsMockFns.mockResolveTrustedFileContext,
  parseInternalFileUrl: fileUtilsMockFns.mockParseInternalFileUrl,
  resolveHttpsUrlFromFileInput: fileUtilsMockFns.mockResolveHttpsUrlFromFileInput,
  processSingleFileToUserFile: fileUtilsMockFns.mockProcessSingleFileToUserFile,
  processFilesToUserFiles: fileUtilsMockFns.mockProcessFilesToUserFiles,
  sanitizeFilenameForMetadata: fileUtilsMockFns.mockSanitizeFilenameForMetadata,
  sanitizeStorageMetadata: fileUtilsMockFns.mockSanitizeStorageMetadata,
  sanitizeFileKey: fileUtilsMockFns.mockSanitizeFileKey,
  extractCleanFilename: fileUtilsMockFns.mockExtractCleanFilename,
  extractWorkspaceIdFromExecutionKey: fileUtilsMockFns.mockExtractWorkspaceIdFromExecutionKey,
  extractWorkspaceIdFromStorageKey: fileUtilsMockFns.mockExtractWorkspaceIdFromStorageKey,
  getViewerUrl: fileUtilsMockFns.mockGetViewerUrl,
}
