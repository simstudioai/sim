import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { SupabaseStorageGetPublicUrlParams } from '@/tools/supabase/types'
import { encodeStoragePath, encodeStorageSegment, supabaseBaseUrl } from '@/tools/supabase/utils'

export const executeStorageGetPublicUrlOperation: InternalToolOperationImplementation<
  SupabaseStorageGetPublicUrlParams
> = async (params: SupabaseStorageGetPublicUrlParams) => {
  const bucket = encodeStorageSegment(params.bucket)
  const path = encodeStoragePath(params.path)
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
