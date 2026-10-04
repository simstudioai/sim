import { getFileExtension, resolveEffectiveMimeType } from '@/lib/uploads/utils/file-utils'

export const FILE_BROWSER_SORTS = ['name', 'size', 'type', 'created', 'owner', 'updated'] as const
export type FileBrowserSort = (typeof FILE_BROWSER_SORTS)[number]
export const FILE_BROWSER_TYPES = ['document', 'image', 'audio', 'video'] as const
export const FILE_BROWSER_SIZES = ['small', 'medium', 'large'] as const
export const FILE_BROWSER_SIZE_BOUNDARIES = { small: 1_048_576, medium: 10_485_760 } as const

export const FILE_BROWSER_TYPE_OPTIONS = [
  { value: 'document', label: 'Documents' },
  { value: 'image', label: 'Images' },
  { value: 'audio', label: 'Audio' },
  { value: 'video', label: 'Video' },
] as const
export const FILE_BROWSER_SIZE_OPTIONS = [
  { value: 'small', label: 'Small (< 1 MB)' },
  { value: 'medium', label: 'Medium (1–10 MB)' },
  { value: 'large', label: 'Large (> 10 MB)' },
] as const
export const FILE_BROWSER_COLUMNS = [
  { id: 'name', header: 'Name', widthMultiplier: 1.15 },
  { id: 'size', header: 'Size', widthMultiplier: 0.85 },
  { id: 'type', header: 'Type', widthMultiplier: 1 },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Last Updated' },
] as const

export const FILE_BROWSER_SORT_OPTIONS = [
  { id: 'name', label: 'Name' },
  { id: 'size', label: 'Size' },
  { id: 'type', label: 'Type' },
  { id: 'created', label: 'Created' },
  { id: 'updated', label: 'Last Updated' },
  { id: 'owner', label: 'Owner' },
] as const

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

/** The displayed file kind also supplies the browser's type ordering. */
export function formatFileBrowserType(storedType: string | null, filename: string): string {
  const mime = resolveEffectiveMimeType(storedType, filename)
  if (FILE_BROWSER_MIME_LABELS[mime]) return FILE_BROWSER_MIME_LABELS[mime]
  if (mime.startsWith('audio/')) return 'Audio'
  if (mime.startsWith('video/')) return 'Video'
  if (mime.startsWith('image/')) return 'Image'
  const extension = getFileExtension(filename)
  return extension ? extension.toUpperCase() : (storedType ?? 'File')
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

export const FILE_ROW_DRAG_MIME = 'application/x-sim-workspace-file-rows'
