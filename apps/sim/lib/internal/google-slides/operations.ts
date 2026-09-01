import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { GoogleSlidesOperationError } from '@/lib/internal/google-slides/errors'
import type { GoogleSlidesExportInput } from '@/lib/internal/google-slides/input'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { presentationUrl } from '@/tools/google_slides/utils'

const MAX_GOOGLE_SLIDES_EXPORT_BYTES = 10 * 1024 * 1024
const MAX_LEGACY_INLINE_EXPORT_BYTES = 7 * 1024 * 1024

const FORMAT_TO_MIME = {
  PDF: 'application/pdf',
  PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ODP: 'application/vnd.oasis.opendocument.presentation',
  TXT: 'text/plain',
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  SVG: 'image/svg+xml',
} as const

export interface GoogleSlidesOperationContext {
  userId: string
  workspaceId?: string
  workflowId?: string
  executionId?: string
  signal?: AbortSignal
}

export async function exportGoogleSlidesPresentation(
  input: GoogleSlidesExportInput,
  context: GoogleSlidesOperationContext
) {
  context.signal?.throwIfAborted()
  const exportFormat = input.exportFormat ?? 'PDF'
  const mimeType = FORMAT_TO_MIME[exportFormat]
  const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.presentationId)}/export?mimeType=${encodeURIComponent(mimeType)}`
  const validation = await validateUrlWithDNS(
    exportUrl,
    'googleSlidesExportUrl',
    'configuredEndpoint'
  )
  context.signal?.throwIfAborted()
  if (!validation.isValid) {
    throw new GoogleSlidesOperationError(
      validation.error || 'Invalid Google Slides export URL',
      400
    )
  }

  const response = await secureFetchWithPinnedIP(exportUrl, validation.resolvedIP, {
    profile: 'configuredEndpoint',
    headers: { Authorization: `Bearer ${input.accessToken}` },
    maxResponseBytes: MAX_GOOGLE_SLIDES_EXPORT_BYTES,
    signal: context.signal,
  })
  if (!response.ok) {
    const errorText = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Google Slides export error response',
      signal: context.signal,
    }).catch(() => '')
    throw new GoogleSlidesOperationError(
      `Failed to export presentation: ${response.status} ${errorText}`,
      response.status
    )
  }

  const buffer = await readResponseToBufferWithLimit(response, {
    maxBytes: MAX_GOOGLE_SLIDES_EXPORT_BYTES,
    label: 'Google Slides export response',
    signal: context.signal,
  })
  context.signal?.throwIfAborted()
  const filename = `${input.presentationId}.${exportFormat.toLowerCase()}`
  const legacyInlineContent =
    buffer.length <= MAX_LEGACY_INLINE_EXPORT_BYTES
      ? { contentBase64: buffer.toString('base64') }
      : {}

  if (context.workspaceId && context.workflowId && context.executionId) {
    const file = await uploadExecutionFile(
      {
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        executionId: context.executionId,
      },
      buffer,
      filename,
      mimeType,
      context.userId
    )
    context.signal?.throwIfAborted()
    return {
      success: true,
      output: {
        file: { ...file, mimeType },
        exportFormat,
        mimeType,
        sizeBytes: buffer.length,
        exportUrl: file.url,
        ...legacyInlineContent,
        metadata: {
          presentationId: input.presentationId,
          url: presentationUrl(input.presentationId),
          exportFormat,
        },
      },
    }
  }

  const file = await uploadCopilotFile({
    buffer,
    fileName: filename,
    contentType: mimeType,
    userId: context.userId,
  })
  context.signal?.throwIfAborted()
  return {
    success: true,
    output: {
      file,
      exportUrl: file.url,
      exportFormat,
      mimeType,
      sizeBytes: buffer.length,
      ...legacyInlineContent,
      metadata: {
        presentationId: input.presentationId,
        url: presentationUrl(input.presentationId),
        exportFormat,
      },
    },
  }
}
