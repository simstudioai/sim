import { getValidationErrorMessage } from '@/lib/api/server'
import { executeSupabaseStorageUpload } from '@/lib/internal/supabase/operations'
import { supabaseStorageUploadInputSchema } from '@/lib/internal/supabase/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeSupabaseTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'supabase_storage_upload') {
    return Response.json({ error: `Unsupported Supabase tool: ${request.toolId}` }, { status: 500 })
  }
  if (!request.context.userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }

  const parsed = supabaseStorageUploadInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        error: getValidationErrorMessage(parsed.error, 'Invalid request data'),
        details: parsed.error.issues,
      },
      { status: 400 }
    )
  }

  return executeSupabaseStorageUpload(parsed.data, {
    userId: request.context.userId,
    requestId: request.requestId,
    signal: request.signal,
  })
}
