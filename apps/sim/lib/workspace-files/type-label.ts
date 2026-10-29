import { getFileExtension, resolveEffectiveMimeType } from '@/lib/uploads/utils/file'

/** The Type column's label for each MIME type it names specifically. */
export const WORKSPACE_FILE_TYPE_LABELS: Readonly<Record<string, string>> = {
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

/**
 * The file's Type column label: a specific label for its effective MIME type, else its media
 * family (Audio, Video, Image), else its extension uppercased, else the stored type. The list's
 * Type sort orders by this same label, spelled in SQL (`workspaceFileTypeLabelExpression`).
 */
export function workspaceFileTypeLabel(storedType: string, filename: string): string {
  const mimeType = resolveEffectiveMimeType(storedType, filename)
  const label = WORKSPACE_FILE_TYPE_LABELS[mimeType]
  if (label) return label
  if (mimeType.startsWith('audio/')) return 'Audio'
  if (mimeType.startsWith('video/')) return 'Video'
  if (mimeType.startsWith('image/')) return 'Image'
  const extension = getFileExtension(filename)
  return extension ? extension.toUpperCase() : storedType
}
