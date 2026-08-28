import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { GoogleVaultOperationError } from '@/lib/internal/google-vault/errors'
import { downloadGoogleVaultExportFile } from '@/lib/internal/google-vault/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const inputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  matterId: z.string().min(1, 'Matter ID is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
  objectName: z.string().min(1, 'Object name is required'),
  fileName: z.string().optional(),
})

export const executeGoogleVaultTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'google_vault_download_export_file') {
    return Response.json(
      { success: false, error: `Unsupported Google Vault tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  const parsed = inputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  try {
    return Response.json(
      await downloadGoogleVaultExportFile(parsed.data, { signal: request.signal })
    )
  } catch (error) {
    request.signal?.throwIfAborted()
    const status = isPayloadSizeLimitError(error)
      ? 413
      : error instanceof GoogleVaultOperationError
        ? error.status
        : 500
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Unknown error occurred') },
      { status }
    )
  }
}
