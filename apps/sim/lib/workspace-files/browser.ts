export const FILE_BROWSER_SORTS = ['name', 'size', 'type', 'created', 'owner', 'updated'] as const
export type FileBrowserSort = (typeof FILE_BROWSER_SORTS)[number]
export const FILE_BROWSER_TYPES = ['document', 'image', 'audio', 'video'] as const
export const FILE_BROWSER_SIZES = ['small', 'medium', 'large'] as const
export const FILE_BROWSER_SIZE_BOUNDARIES = { small: 1_048_576, medium: 10_485_760 } as const

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
