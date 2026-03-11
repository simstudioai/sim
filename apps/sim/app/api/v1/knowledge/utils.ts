import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { getKnowledgeBaseById } from '@/lib/knowledge/service'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import {
  checkRateLimit,
  checkWorkspaceScope,
  createRateLimitResponse,
  type RateLimitResult,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1KnowledgeAPI')

type EndpointKey = 'knowledge' | 'knowledge-detail' | 'knowledge-search'

/**
 * Successful authentication result with request context
 */
export interface AuthorizedRequest {
  requestId: string
  userId: string
  rateLimit: RateLimitResult
}

/**
 * Authenticates and rate-limits a v1 knowledge API request.
 * Returns NextResponse on failure, AuthorizedRequest on success.
 */
export async function authenticateRequest(
  request: NextRequest,
  endpoint: EndpointKey
): Promise<AuthorizedRequest | NextResponse> {
  const requestId = generateRequestId()
  const rateLimit = await checkRateLimit(request, endpoint)
  if (!rateLimit.allowed) {
    return createRateLimitResponse(rateLimit)
  }
  return { requestId, userId: rateLimit.userId!, rateLimit }
}

/**
 * Validates workspace scope and user permission level.
 * Returns null on success, NextResponse on failure.
 */
export async function validateWorkspaceAccess(
  rateLimit: RateLimitResult,
  userId: string,
  workspaceId: string,
  level: 'read' | 'write' = 'read'
): Promise<NextResponse | null> {
  const scopeError = checkWorkspaceScope(rateLimit, workspaceId)
  if (scopeError) return scopeError

  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (permission === null) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }
  if (level === 'write' && permission === 'read') {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }
  return null
}

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
 * Validates data against a Zod schema with consistent error response.
 */
export function validateSchema<S extends z.ZodType>(
  schema: S,
  data: unknown
): { success: true; data: z.output<S> } | { success: false; response: NextResponse } {
  const result = schema.safeParse(data)
  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(
        { error: 'Validation error', details: result.error.errors },
        { status: 400 }
      ),
    }
  }
  return { success: true, data: result.data }
}

/**
 * Safely parses a JSON request body with consistent error response.
 */
export async function parseJsonBody(
  request: NextRequest
): Promise<{ success: true; data: unknown } | { success: false; response: NextResponse }> {
  try {
    const data = await request.json()
    return { success: true, data }
  } catch {
    return {
      success: false,
      response: NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 }),
    }
  }
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
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 })
  }

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
