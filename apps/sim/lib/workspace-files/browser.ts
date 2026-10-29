import { getFileExtension, resolveEffectiveMimeType } from '@/lib/uploads/utils/file'
import { normalizeMimeType } from '@/lib/uploads/utils/mime'

export const FILE_BROWSER_SORTS = ['name', 'size', 'type', 'created', 'owner', 'updated'] as const
export type FileBrowserSort = (typeof FILE_BROWSER_SORTS)[number]
/**
 * The file kinds the file browsers filter by. A file can be several at once — a `.json` is a
 * document whatever its stored type: `document` is decided by extension
 * (`SUPPORTED_DOCUMENT_EXTENSIONS`), the media kinds by the file's effective MIME type.
 */
export const FILE_BROWSER_TYPES = ['document', 'image', 'audio', 'video'] as const
export type FileBrowserType = (typeof FILE_BROWSER_TYPES)[number]
export const FILE_BROWSER_SIZES = ['small', 'medium', 'large'] as const
export type FileBrowserSize = (typeof FILE_BROWSER_SIZES)[number]
/** Small is under 1 MiB, medium 1 to 10 MiB inclusive, large over 10 MiB. */
export const FILE_BROWSER_SIZE_BOUNDARIES = { small: 1_048_576, medium: 10_485_760 } as const

export function isFileBrowserType(value: string): value is FileBrowserType {
  return (FILE_BROWSER_TYPES as readonly string[]).includes(value)
}

export function isFileBrowserSize(value: string): value is FileBrowserSize {
  return (FILE_BROWSER_SIZES as readonly string[]).includes(value)
}

export const FILE_BROWSER_MIME_LABELS: Readonly<Record<string, string>> = {
  'application/pdf': 'PDF',
  'application/zip': 'ZIP',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.ms-excel': 'Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.ms-powerpoint': 'PowerPoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
  'application/json': 'JSON',
  'application/x-yaml': 'YAML',
  'text/csv': 'CSV',
  'text/plain': 'Text',
  'text/html': 'HTML',
  'text/x-sim-page': 'Page',
  'text/markdown': 'Markdown',
}

export interface FileBrowserCreator {
  id: string
  name: string
  image: string | null
  deleted: boolean
}

export interface FileBrowserItem {
  id: string
  kind: 'file' | 'folder'
  name: string
  parentId: string | null
  size: number
  type: string
  createdAt: Date
  updatedAt: Date
  creator: FileBrowserCreator | null
}

export interface FileBrowserFilters {
  types?: readonly (typeof FILE_BROWSER_TYPES)[number][]
  sizes?: readonly (typeof FILE_BROWSER_SIZES)[number][]
  creatorIds?: readonly string[]
}

/**
 * The MIME type the file browsers classify a file by: its stored type read as
 * `normalizeMimeType` reads it (lowercased, parameters dropped), else its extension's — the
 * rule `declaredMimeSql` and `effectiveMimeSql` spell for SQL.
 */
export function fileBrowserMimeType(storedType: string, filename: string): string {
  return resolveEffectiveMimeType(normalizeMimeType(storedType), filename)
}

/**
 * A file's Type column label: a specific label for its effective MIME type, else its media
 * family (Audio, Video, Image), else its extension uppercased, else the stored type. The SQL
 * twin is `fileTypeLabelSql`, which the browsers' Type sorts order by.
 */
export function fileBrowserTypeLabel(storedType: string, filename: string): string {
  const mimeType = fileBrowserMimeType(storedType, filename)
  const label = FILE_BROWSER_MIME_LABELS[mimeType]
  if (label) return label
  if (mimeType.startsWith('audio/')) return 'Audio'
  if (mimeType.startsWith('video/')) return 'Video'
  if (mimeType.startsWith('image/')) return 'Image'
  const extension = getFileExtension(filename)
  return extension ? extension.toUpperCase() : storedType
}
