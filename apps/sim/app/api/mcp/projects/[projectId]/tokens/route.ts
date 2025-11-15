import type { NextRequest } from 'next/server'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { getProjectIdFromRequest } from '@/lib/mcp/request-utils'
import {
  issueMcpServerToken,
  listMcpServerTokens,
  revokeMcpServerToken,
} from '@/lib/mcp/token-service'
import { createLogger } from '@/lib/logs/console/logger'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('McpProjectTokensAPI')
const SCOPE_VALUES = new Set(['deploy', 'runtime', 'logs'])

export const dynamic = 'force-dynamic'

export const GET = withMcpAuth('read')(async (request: NextRequest, context) => {
  const projectId = getProjectIdFromRequest(request)
  if (!projectId) {
    return createMcpErrorResponse(new Error('Project ID missing from URL'), 'Missing projectId', 400)
  }

  try {
    const tokens = await listMcpServerTokens(context.workspaceId, projectId)
    return createMcpSuccessResponse({ tokens })
  } catch (error) {
    logger.error(`[${context.requestId}] Failed to list tokens for ${projectId}`, error)
    return createMcpErrorResponse(
      error instanceof Error ? error : new Error('Failed to list tokens'),
      'Failed to list tokens',
      500
    )
  }
})

export const POST = withMcpAuth('write')(async (request: NextRequest, context) => {
  const projectId = getProjectIdFromRequest(request)
  if (!projectId) {
    return createMcpErrorResponse(new Error('Project ID missing from URL'), 'Missing projectId', 400)
  }

  try {
    const body = getParsedBody(request) || (await request.json())
    if (!body?.name) {
      return createMcpErrorResponse(new Error('Token name is required'), 'Missing name', 400)
    }

    const scope = SCOPE_VALUES.has(body.scope) ? body.scope : undefined
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined

    const result = await issueMcpServerToken({
      workspaceId: context.workspaceId,
      projectId,
      name: body.name,
      scope,
      expiresAt,
      createdBy: context.userId,
    })

    return createMcpSuccessResponse({ token: result.token, record: result.record }, 201)
  } catch (error) {
    logger.error(`[${context.requestId}] Failed to issue token for ${projectId}`, error)
    return createMcpErrorResponse(
      error instanceof Error ? error : new Error('Failed to issue token'),
      error instanceof Error ? error.message : 'Failed to issue token',
      500
    )
  }
})

export const DELETE = withMcpAuth('admin')(async (request: NextRequest, context) => {
  const projectId = getProjectIdFromRequest(request)
  if (!projectId) {
    return createMcpErrorResponse(new Error('Project ID missing from URL'), 'Missing projectId', 400)
  }

  const { searchParams } = request.nextUrl
  const tokenId = searchParams.get('tokenId')

  if (!tokenId) {
    return createMcpErrorResponse(new Error('tokenId is required'), 'Missing tokenId', 400)
  }

  try {
    await revokeMcpServerToken(context.workspaceId, projectId, tokenId)
    return createMcpSuccessResponse({ tokenId })
  } catch (error) {
    logger.error(`[${context.requestId}] Failed to revoke token ${tokenId}`, error)
    return createMcpErrorResponse(
      error instanceof Error ? error : new Error('Failed to revoke token'),
      error instanceof Error ? error.message : 'Failed to revoke token',
      500
    )
  }
})
