import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import {
  FORMAT_TO_MIME,
  getGoogleSlidesExportExecutionContext,
  MAX_LEGACY_INLINE_EXPORT_BYTES,
  readGoogleSlidesExportResponse,
} from '@/tools/google_slides/export_presentation'
import { presentationUrl } from '@/tools/google_slides/utils'

interface ExportPresentationParams {
  accessToken: string
  presentationId: string
  exportFormat?: 'PDF' | 'PPTX' | 'ODP' | 'TXT' | 'PNG' | 'JPEG' | 'SVG'
  _context?: Record<string, unknown>
}

export async function transformGoogleSlidesExportResponse(
  response: Response,
  params?: ExportPresentationParams
) {
  const buffer = await readGoogleSlidesExportResponse(response)
  const presentationId = params?.presentationId?.trim() || ''
  const format = (params?.exportFormat || 'PDF').toUpperCase()
  const mime = FORMAT_TO_MIME[format] ?? 'application/octet-stream'
  const { context, userId } = getGoogleSlidesExportExecutionContext(params)
  const filename = `${presentationId || 'presentation'}.${format.toLowerCase()}`
  const userFile = context
    ? await uploadExecutionFile(context, Buffer.from(buffer), filename, mime, userId)
    : undefined

  if (!userFile && buffer.length > MAX_LEGACY_INLINE_EXPORT_BYTES) {
    throw new PayloadSizeLimitError({
      label: 'Google Slides legacy inline export',
      maxBytes: MAX_LEGACY_INLINE_EXPORT_BYTES,
      observedBytes: buffer.length,
    })
  }

  const contentBase64 =
    !userFile && buffer.length <= MAX_LEGACY_INLINE_EXPORT_BYTES
      ? buffer.toString('base64')
      : undefined

  return {
    success: true,
    output: {
      ...(userFile ? { file: { ...userFile, mimeType: mime } } : {}),
      ...(contentBase64 ? { contentBase64 } : {}),
      mimeType: mime,
      sizeBytes: buffer.length,
      metadata: {
        presentationId,
        url: presentationUrl(presentationId),
        exportFormat: format,
      },
    },
  }
}
