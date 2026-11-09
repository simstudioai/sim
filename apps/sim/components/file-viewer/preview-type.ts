import { getFileExtension } from '@/lib/uploads/utils/file'
import { normalizeMimeType } from '@/lib/uploads/utils/mime'

/** A text format with a rendered view beside or instead of its source. */
export type PreviewType = 'markdown' | 'html' | 'csv' | 'svg' | 'mermaid' | 'chart' | null

const PREVIEWABLE_MIME_TYPES: Record<string, PreviewType> = {
  /** A Sim page's name has no extension, so its record type is what selects the page view. */
  'text/x-sim-page': 'html',
  'text/markdown': 'markdown',
  'text/html': 'html',
  'text/csv': 'csv',
  'image/svg+xml': 'svg',
  'text/x-mermaid': 'mermaid',
  'text/x-sim-chart': 'chart',
}

const PREVIEWABLE_EXTENSIONS: Record<string, PreviewType> = {
  md: 'markdown',
  html: 'html',
  htm: 'html',
  csv: 'csv',
  svg: 'svg',
  mmd: 'mermaid',
  chart: 'chart',
}

/** Which rendered view a text file has, by its record type, else its extension. */
export function resolvePreviewType(mimeType: string | null, filename: string): PreviewType {
  const normalized = normalizeMimeType(mimeType)
  if (normalized && PREVIEWABLE_MIME_TYPES[normalized]) return PREVIEWABLE_MIME_TYPES[normalized]
  return PREVIEWABLE_EXTENSIONS[getFileExtension(filename)] ?? null
}
