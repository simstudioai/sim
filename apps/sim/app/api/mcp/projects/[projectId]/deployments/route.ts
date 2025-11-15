import type { NextRequest } from 'next/server'
import { tasks } from '@trigger.dev/sdk'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { getProjectIdFromRequest } from '@/lib/mcp/request-utils'
import {
  createMcpServerDeployment,
  listMcpServerDeployments,
} from '@/lib/mcp/deployment-service'
import { createLogger } from '@/lib/logs/console/logger'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('McpProjectDeploymentsAPI')
export const dynamic = 'force-dynamic'

export const GET = withMcpAuth('read')(async (request: NextRequest, context) => {
  const projectId = getProjectIdFromRequest(request)
  if (!projectId) {
    return createMcpErrorResponse(new Error('Project ID missing from URL'), 'Missing projectId', 400)
  }

  try {
    const deployments = await listMcpServerDeployments(context.workspaceId, projectId)
    return createMcpSuccessResponse({ deployments })
  } catch (error) {
    logger.error(`[${context.requestId}] Failed to list deployments for ${projectId}`, error)
    return createMcpErrorResponse(
      error instanceof Error ? error : new Error('Failed to list deployments'),
      'Failed to list deployments',
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
    if (!body?.versionId) {
      return createMcpErrorResponse(new Error('versionId is required'), 'Missing versionId', 400)
    }

    const deployment = await createMcpServerDeployment({
      workspaceId: context.workspaceId,
      projectId,
      versionId: body.versionId,
      environment: body.environment,
      region: body.region,
      serverId: body.serverId,
      deployedBy: context.userId,
    })

    await tasks.trigger('mcp-server-deploy', {
      deploymentId: deployment.id,
      projectId,
      versionId: body.versionId,
      workspaceId: context.workspaceId,
      userId: context.userId,
    })

    return createMcpSuccessResponse({ deployment }, 201)
  } catch (error) {
    logger.error(`[${context.requestId}] Failed to create deployment for ${projectId}`, error)
    return createMcpErrorResponse(
      error instanceof Error ? error : new Error('Failed to create deployment'),
      error instanceof Error ? error.message : 'Failed to create deployment',
      500
    )
  }
})
