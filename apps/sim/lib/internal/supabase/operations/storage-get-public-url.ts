import { getErrorMessage } from '@sim/utils/errors'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { SupabaseStorageGetPublicUrlParams } from '@/tools/supabase/types'
import { encodeStoragePath, encodeStorageSegment, supabaseBaseUrl } from '@/tools/supabase/utils'

export const executeStorageGetPublicUrlOperation: InternalToolOperationImplementation<
  SupabaseStorageGetPublicUrlParams
> = async (params: SupabaseStorageGetPublicUrlParams) => {
  /**
   * Same reasoning as the upload operation: the path guards throw on
   * caller-supplied values, and an uncaught throw here escapes as an opaque
   * server failure rather than the guard's named message. This operation
   * reports failure in its own result shape, so the rejection is surfaced there.
   */
  let bucket: string
  let path: string
  try {
    bucket = encodeStorageSegment(params.bucket)
    path = encodeStoragePath(params.path)
  } catch (error) {
    return {
      success: false,
      output: { message: getErrorMessage(error, 'Invalid storage path'), publicUrl: '' },
      error: getErrorMessage(error, 'Invalid storage path'),
    }
  }
  let publicUrl = `${supabaseBaseUrl(params.projectId)}/storage/v1/object/public/${bucket}/${path}`

  if (params.download) {
    // Supabase's `download` query param is a filename override, not a
    // boolean flag — an empty value forces a download while preserving
    // the original filename. Sending the literal string "true" would
    // instead rename the downloaded file to "true".
    publicUrl += '?download='
  }

  return {
    success: true,
    output: {
      message: 'Successfully generated public URL',
      publicUrl,
    },
    error: undefined,
  }
}
