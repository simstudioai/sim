import type { NextRequest } from 'next/server'
import { createMcpServerVersion, listMcpServerVersions } from '@/lib/mcp/version-service'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { getProjectIdFromRequest } from '@/lib/mcp/request-utils'
import { createLogger } from '@/lib/logs/console/logger'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('McpProjectVersionsAPI')
export const dynamic = 'force-dynamic'

export const GET = withMcpAuth('read')(async (request: NextRequest, context) => {
  const projectId = getProjectIdFromRequest(request)

  if (!projectId) {
    return createMcpErrorResponse(new Error('Project ID missing from URL'), 'Missing projectId', 400)
  }

  try {
    const versions = await listMcpServerVersions(context.workspaceId, projectId)
    return createMcpSuccessResponse({ versions })
  } catch (error) {
    logger.error(`[${context.requestId}] Failed to list versions for ${projectId}`, error)
    return createMcpErrorResponse(
      error instanceof Error ? error : new Error('Failed to list versions'),
      'Failed to list versions',
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
    const version = await createMcpServerVersion({
      workspaceId: context.workspaceId,
      projectId,
      sourceHash: body.sourceHash,
      manifest: body.manifest,
      buildConfig: body.buildConfig,
      artifactUrl: body.artifactUrl,
      runtimeMetadata: body.runtimeMetadata,
      changelog: body.changelog,
      buildLogsUrl: body.buildLogsUrl,
    })

    return createMcpSuccessResponse({ version }, 201)
  } catch (error) {
    logger.error(`[${context.requestId}] Failed to create MCP version for ${projectId}`, error)
    return createMcpErrorResponse(
      error instanceof Error ? error : new Error('Failed to create version'),
      error instanceof Error ? error.message : 'Failed to create version',
      500
    )
  }
})
