import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import { SUPPORTED_CODE_EXTENSIONS } from '@/lib/uploads/utils/validation'

const TEXT_EDITABLE_MIME_TYPES = new Set([
  'text/markdown',
  'text/plain',
  'application/json',
  'application/x-yaml',
  'text/csv',
  'text/html',
  'text/xml',
  'application/xml',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/typescript',
  'application/toml',
  'text/x-python',
  'text/x-sh',
  'text/x-sql',
  'image/svg+xml',
  'text/x-mermaid',
])

const TEXT_EDITABLE_EXTENSIONS = new Set([
  'md',
  'txt',
  'json',
  'yaml',
  'yml',
  'csv',
  'html',
  'htm',
  'svg',
  'mmd',
  ...SUPPORTED_CODE_EXTENSIONS,
])

const IFRAME_PREVIEWABLE_MIME_TYPES = new Set(['application/pdf', 'text/x-pdflibjs'])
const IFRAME_PREVIEWABLE_EXTENSIONS = new Set(['pdf'])

const IMAGE_PREVIEWABLE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const IMAGE_PREVIEWABLE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

const AUDIO_PREVIEWABLE_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
  'audio/flac',
  'audio/aac',
  'audio/opus',
  'audio/x-m4a',
])
const AUDIO_PREVIEWABLE_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac', 'opus'])

const VIDEO_PREVIEWABLE_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
])
const VIDEO_PREVIEWABLE_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm'])

const PPTX_PREVIEWABLE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/x-pptxgenjs',
])
const PPTX_PREVIEWABLE_EXTENSIONS = new Set(['pptx'])

const DOCX_PREVIEWABLE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/x-docxjs',
])
const DOCX_PREVIEWABLE_EXTENSIONS = new Set(['docx'])

const XLSX_PREVIEWABLE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])
const XLSX_PREVIEWABLE_EXTENSIONS = new Set(['xlsx'])

export type FileCategory =
  | 'text-editable'
  | 'iframe-previewable'
  | 'image-previewable'
  | 'audio-previewable'
  | 'video-previewable'
  | 'pptx-previewable'
  | 'docx-previewable'
  | 'xlsx-previewable'
  | 'unsupported'

export function resolveFileCategory(mimeType: string | null, filename: string): FileCategory {
  if (mimeType && TEXT_EDITABLE_MIME_TYPES.has(mimeType)) return 'text-editable'
  if (mimeType && IFRAME_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'iframe-previewable'
  if (mimeType && IMAGE_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'image-previewable'
  if (mimeType && AUDIO_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'audio-previewable'
  if (mimeType && VIDEO_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'video-previewable'
  if (mimeType && DOCX_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'docx-previewable'
  if (mimeType && PPTX_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'pptx-previewable'
  if (mimeType && XLSX_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'xlsx-previewable'

  const ext = getFileExtension(filename)
  const nameKey = ext || filename.toLowerCase()
  if (TEXT_EDITABLE_EXTENSIONS.has(nameKey)) return 'text-editable'
  if (IFRAME_PREVIEWABLE_EXTENSIONS.has(ext)) return 'iframe-previewable'
  if (IMAGE_PREVIEWABLE_EXTENSIONS.has(ext)) return 'image-previewable'
  if (AUDIO_PREVIEWABLE_EXTENSIONS.has(ext)) return 'audio-previewable'
  if (VIDEO_PREVIEWABLE_EXTENSIONS.has(ext)) return 'video-previewable'
  if (DOCX_PREVIEWABLE_EXTENSIONS.has(ext)) return 'docx-previewable'
  if (PPTX_PREVIEWABLE_EXTENSIONS.has(ext)) return 'pptx-previewable'
  if (XLSX_PREVIEWABLE_EXTENSIONS.has(ext)) return 'xlsx-previewable'

  return 'unsupported'
}
