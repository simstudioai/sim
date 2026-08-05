import { NextResponse } from 'next/server'
import {
  type InternalFileUploadSession,
  internalFileUploadSessionSchema,
} from '@/lib/api/contracts/upload-sessions'
import { getSession } from '@/lib/auth'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'
import type { UploadActor, UploadPurposeResult } from '@/app/api/files/uploads/finalizers'

export async function requireUploadUser(): Promise<UploadActor | NextResponse> {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  }
}

export function uploadSessionErrorResponse(error: unknown): NextResponse | null {
  const classified = asOrchestrationError(error)
  return classified
    ? NextResponse.json(
        { error: classified.message },
        { status: statusForOrchestrationError(classified.code) }
      )
    : null
}

export function toInternalUploadSession(
  session: UploadSessionRecord,
  result: UploadPurposeResult | null
): InternalFileUploadSession {
  return internalFileUploadSessionSchema.parse({
    id: session.id,
    purpose: session.purpose,
    status: session.status,
    name: session.fileName,
    contentType: session.contentType,
    size: session.fileSize,
    expiresAt: session.expiresAt.toISOString(),
    error: session.error,
    result,
  })
}
