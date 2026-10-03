import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { WordPressOperationError } from '@/lib/internal/wordpress/errors'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import {
  getFileExtension,
  getMimeTypeFromExtension,
  processSingleFileToUserFile,
} from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { WordPressUploadMediaResponse } from '@/tools/wordpress/types'

const logger = createLogger('WordPressOperations')
const WORDPRESS_COM_API_BASE = 'https://public-api.wordpress.com/wp/v2/sites'
const MAX_WORDPRESS_RESPONSE_BYTES = 2 * 1024 * 1024

interface WordPressMediaPayload {
  id: number
  date: string
  slug: string
  type: string
  link: string
  title: { rendered: string }
  caption: { rendered: string }
  alt_text: string
  media_type: string
  mime_type: string
  source_url: string
  media_details?: { width?: number; height?: number; file?: string }
}

export interface WordPressOperationContext {
  userId: string
  requestId: string
  signal?: AbortSignal
}

export interface WordPressUploadMediaInput {
  accessToken: string
  siteId: string
  file?: RawFileInput | null
  filename?: string | null
  title?: string | null
  caption?: string | null
  altText?: string | null
  description?: string | null
}

export async function uploadWordPressMedia(
  input: WordPressUploadMediaInput,
  context: WordPressOperationContext
): Promise<WordPressUploadMediaResponse> {
  context.signal?.throwIfAborted()
  if (!input.file) {
    throw new WordPressOperationError('No file provided. Please upload a file.', 400)
  }
  let userFile
  try {
    userFile = processSingleFileToUserFile(input.file, context.requestId, logger)
  } catch (error) {
    throw new WordPressOperationError(getErrorMessage(error, 'Failed to process file'), 400)
  }
  const denied = await assertToolFileAccess(userFile.key, context.userId, context.requestId, logger)
  if (denied) throw new WordPressOperationError('File not found', denied.status)
  context.signal?.throwIfAborted()

  let fileBuffer: Buffer
  let resolvedContentType: string
  try {
    const servable = await downloadServableFileFromStorage(userFile, context.requestId, logger, {
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    })
    fileBuffer = servable.buffer
    resolvedContentType = servable.contentType
  } catch (error) {
    throw new WordPressOperationError(
      `Failed to download file: ${getErrorMessage(error, 'Unknown error')}`,
      500
    )
  }
  context.signal?.throwIfAborted()

  const filename = input.filename || userFile.name
  const mimeType =
    resolvedContentType || userFile.type || getMimeTypeFromExtension(getFileExtension(filename))
  const formData = new FormData()
  formData.append('file', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), filename)
  if (input.title) formData.append('title', input.title)
  if (input.caption) formData.append('caption', input.caption)
  if (input.altText) formData.append('alt_text', input.altText)
  if (input.description) formData.append('description', input.description)

  const response = await fetch(`${WORDPRESS_COM_API_BASE}/${input.siteId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.accessToken}` },
    body: formData,
    signal: context.signal,
  })
  if (!response.ok) {
    const errorText = await readResponseTextWithLimit(response, {
      maxBytes: MAX_WORDPRESS_RESPONSE_BYTES,
      label: 'WordPress error response',
      signal: context.signal,
    })
    let message = `WordPress API error: ${response.statusText}`
    try {
      const parsed = JSON.parse(errorText) as { message?: string; error?: string }
      message = parsed.message || parsed.error || message
    } catch {}
    throw new WordPressOperationError(message, response.status)
  }
  const media = await readResponseJsonWithLimit<WordPressMediaPayload>(response, {
    maxBytes: MAX_WORDPRESS_RESPONSE_BYTES,
    label: 'WordPress upload response',
    signal: context.signal,
  })
  return { success: true, output: { media } }
}
