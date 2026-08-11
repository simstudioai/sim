import type { V2FileUpload } from '@/lib/api/contracts/v2/files'
import type { V2UploadStatus } from '@/lib/api/contracts/v2/uploads'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'
import { toV2File } from '@/app/api/v2/files/utils'

export async function toV2FileUpload(
  session: UploadSessionRecord,
  file: WorkspaceFileRecord | null
): Promise<V2FileUpload> {
  return {
    id: session.id,
    status: uploadStatus(session.status),
    name: session.fileName,
    contentType: session.contentType,
    size: session.fileSize,
    expiresAt: session.expiresAt.toISOString(),
    error: session.error,
    file: file ? await toV2File(file) : null,
  }
}

function uploadStatus(status: string): V2UploadStatus {
  if (
    status !== 'uploading' &&
    status !== 'completing' &&
    status !== 'finalizing' &&
    status !== 'completed' &&
    status !== 'failed' &&
    status !== 'aborting' &&
    status !== 'aborted' &&
    status !== 'expired'
  ) {
    throw new Error(`Invalid upload session status: ${status}`)
  }
  return status
}

import type { Principal } from '@sim/auth/principal'
import type { NextRequest, NextResponse } from 'next/server'
import { authenticateV2ApiKey } from '@/lib/api/server/routes/v2-api-key-auth'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

/** Re-authenticates the API key for each upload control leg. */
export async function authenticateUploadPrincipal(request: NextRequest): Promise<Principal> {
  const auth = await authenticateV2ApiKey(request.headers.get('x-api-key'))
  return auth.principal
}

/** Resource-ID upload controls conceal authorization failures as absence. */
export function v2UploadControlError(error: unknown): NextResponse | null {
  const response = v2CaughtOrchestrationError(error)
  if (!response) return null
  return response.status === 403 ? v2Error('NOT_FOUND', 'Upload session not found') : response
}
