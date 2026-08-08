import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
import { KnowledgeDocumentUnsupportedMediaTypeError } from '@/lib/knowledge/application/upload-sessions'
import { uploadSessionErrorResponse } from '@/app/api/files/uploads/utils'

export interface KnowledgeDocumentUploadActor {
  id: string
  sessionId: string
  name?: string | null
  email?: string | null
}

export async function requireKnowledgeDocumentUploadActor(): Promise<
  KnowledgeDocumentUploadActor | NextResponse
> {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionId = session.session?.id
  if (!sessionId) throw new Error('Authenticated session is missing its session ID')
  return {
    id: session.user.id,
    sessionId,
    name: session.user.name,
    email: session.user.email,
  }
}

export function knowledgeDocumentUploadErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof KnowledgeDocumentUnsupportedMediaTypeError) {
    return NextResponse.json({ error: error.message }, { status: 415 })
  }
  if (error instanceof KnowledgeUsageLimitExceededError) {
    return NextResponse.json({ error: error.message }, { status: 402 })
  }
  return uploadSessionErrorResponse(error)
}
