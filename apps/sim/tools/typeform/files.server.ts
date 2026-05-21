import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import {
  getTypeformExecutionContext,
  MAX_LEGACY_INLINE_FILE_BYTES,
  readTypeformFileResponse,
} from '@/tools/typeform/files'
import type { TypeformFilesParams, TypeformFilesResponse } from '@/tools/typeform/types'

export async function transformTypeformFilesResponse(
  response: Response,
  params?: TypeformFilesParams
): Promise<TypeformFilesResponse> {
  const { buffer, contentType, filename, fileUrl } = await readTypeformFileResponse(
    response,
    params
  )
  const { context, userId } = getTypeformExecutionContext(params)
  const storedFile = context
    ? {
        ...(await uploadExecutionFile(context, buffer, filename, contentType, userId)),
        mimeType: contentType,
      }
    : undefined

  if (!storedFile && buffer.length > MAX_LEGACY_INLINE_FILE_BYTES) {
    throw new PayloadSizeLimitError({
      label: 'Typeform legacy inline file',
      maxBytes: MAX_LEGACY_INLINE_FILE_BYTES,
      observedBytes: buffer.length,
    })
  }

  return {
    success: true,
    output: {
      fileUrl: storedFile?.url || fileUrl || '',
      file: storedFile ?? {
        name: filename,
        mimeType: contentType,
        data: buffer.toString('base64'),
        size: buffer.length,
      },
      contentType,
      filename,
    },
  }
}
