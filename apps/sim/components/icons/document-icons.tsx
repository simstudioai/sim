import type { SVGProps } from 'react'
import {
  AudioIcon,
  ChartFileIcon,
  CsvIcon,
  DefaultFileIcon,
  DocxIcon,
  HtmlIcon,
  JsonIcon,
  MarkdownIcon,
  PdfIcon,
  PptxIcon,
  TxtIcon,
  VideoIcon,
  XlsxIcon,
  ZipIcon,
} from '@sim/emcn/icons'
import {
  SUPPORTED_ARCHIVE_EXTENSIONS,
  SUPPORTED_ARCHIVE_MIME_TYPES,
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
} from '@/lib/uploads/utils/validation'

export function getDocumentIcon(
  rawMimeType: string,
  filename: string
): (props: SVGProps<SVGSVGElement>) => React.JSX.Element {
  const mimeType = rawMimeType.split(';')[0].trim().toLowerCase()
  const extension = filename.split('.').pop()?.toLowerCase()

  if (
    mimeType.startsWith('audio/') ||
    (extension &&
      SUPPORTED_AUDIO_EXTENSIONS.includes(extension as (typeof SUPPORTED_AUDIO_EXTENSIONS)[number]))
  ) {
    return AudioIcon
  }

  if (
    mimeType.startsWith('video/') ||
    (extension &&
      SUPPORTED_VIDEO_EXTENSIONS.includes(extension as (typeof SUPPORTED_VIDEO_EXTENSIONS)[number]))
  ) {
    return VideoIcon
  }

  if (mimeType === 'application/pdf' || extension === 'pdf') {
    return PdfIcon
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword' ||
    extension === 'docx' ||
    extension === 'doc'
  ) {
    return DocxIcon
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel' ||
    extension === 'xlsx' ||
    extension === 'xls'
  ) {
    return XlsxIcon
  }

  if (mimeType === 'text/csv' || extension === 'csv') {
    return CsvIcon
  }

  if (mimeType === 'text/plain' || extension === 'txt') {
    return TxtIcon
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'application/vnd.ms-powerpoint' ||
    extension === 'pptx' ||
    extension === 'ppt'
  ) {
    return PptxIcon
  }

  if (
    SUPPORTED_ARCHIVE_MIME_TYPES.includes(mimeType) ||
    (extension &&
      SUPPORTED_ARCHIVE_EXTENSIONS.includes(
        extension as (typeof SUPPORTED_ARCHIVE_EXTENSIONS)[number]
      ))
  ) {
    return ZipIcon
  }

  if (mimeType === 'text/x-sim-chart' || extension === 'chart') {
    return ChartFileIcon
  }

  // Sim pages present as plain documents, not as HTML artifacts — the .html
  // is an implementation detail (legacy pages still carry the extension).
  if (mimeType === 'text/x-sim-page') {
    return DefaultFileIcon
  }

  if (mimeType === 'text/html' || extension === 'html' || extension === 'htm') {
    return HtmlIcon
  }

  if (mimeType === 'application/json' || extension === 'json') {
    return JsonIcon
  }

  if (mimeType === 'text/markdown' || extension === 'md' || extension === 'mdx') {
    return MarkdownIcon
  }

  return DefaultFileIcon
}
