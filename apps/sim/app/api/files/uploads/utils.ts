import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export async function requireUploadUser(): Promise<string | NextResponse> {
  const session = await getSession()
  return session?.user?.id ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function requireWorkspaceWrite(
  userId: string,
  workspaceId: string
): Promise<NextResponse | null> {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  return permission === 'write' || permission === 'admin'
    ? null
    : NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
