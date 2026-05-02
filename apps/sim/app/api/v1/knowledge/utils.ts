import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { validationErrorResponseFromError } from '@/lib/api/server'
import { getKnowledgeBaseById } from '@/lib/knowledge/service'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { type RateLimitResult, validateWorkspaceAccess } from '@/app/api/v1/middleware'

const logger = createLogger('V1KnowledgeAPI')

/**
 * Fetches a KB by ID, validates it exists, belongs to the workspace,
 * and the user has permission. Returns the KB or a NextResponse error.
 */
export async function resolveKnowledgeBase(
  id: string,
  workspaceId: string,
  userId: string,
  rateLimit: RateLimitResult,
  level: 'read' | 'write' = 'read'
): Promise<{ kb: KnowledgeBaseWithCounts } | NextResponse> {
  const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId, level)
  if (accessError) return accessError

  const kb = await getKnowledgeBaseById(id)
  if (!kb) {
    return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
  }
  if (kb.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
  }
  return { kb }
}

/**
 * Serializes a date value for JSON responses.
 */
export function serializeDate(date: Date | string | null | undefined): string | null {
  if (date === null || date === undefined) return null
  if (date instanceof Date) return date.toISOString()
  return String(date)
}

/**
 * Formats a KnowledgeBaseWithCounts into the API response shape.
 */
export function formatKnowledgeBase(kb: KnowledgeBaseWithCounts) {
  return {
    id: kb.id,
    name: kb.name,
    description: kb.description,
    tokenCount: kb.tokenCount,
    embeddingModel: kb.embeddingModel,
    embeddingDimension: kb.embeddingDimension,
    chunkingConfig: kb.chunkingConfig,
    docCount: kb.docCount,
    connectorTypes: kb.connectorTypes,
    createdAt: serializeDate(kb.createdAt),
    updatedAt: serializeDate(kb.updatedAt),
  }
}

/**
 * Handles unexpected errors with consistent logging and response.
 */
export function handleError(
  requestId: string,
  error: unknown,
  defaultMessage: string
): NextResponse {
  const validationResponse = validationErrorResponseFromError(error)
  if (validationResponse) return validationResponse

  if (error instanceof Error) {
    if (error.message.includes('does not have permission')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const isStorageLimitError =
      error.message.includes('Storage limit exceeded') || error.message.includes('storage limit')
    if (isStorageLimitError) {
      return NextResponse.json({ error: 'Storage limit exceeded' }, { status: 413 })
    }

    const isDuplicate = error.message.includes('already exists')
    if (isDuplicate) {
      return NextResponse.json({ error: 'Resource already exists' }, { status: 409 })
    }
  }

  logger.error(`[${requestId}] ${defaultMessage}:`, error)
  return NextResponse.json({ error: defaultMessage }, { status: 500 })
}
