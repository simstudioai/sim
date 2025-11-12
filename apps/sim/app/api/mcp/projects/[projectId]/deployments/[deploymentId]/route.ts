import type { NextRequest } from 'next/server'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import {
  getProjectIdFromRequest,
  getDeploymentIdFromRequest,
} from '@/lib/mcp/request-utils'
import {
  getMcpServerDeployment,
  updateMcpServerDeployment,
} from '@/lib/mcp/deployment-service'
import { createLogger } from '@/lib/logs/console/logger'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('McpProjectDeploymentDetailsAPI')
const STATUS_VALUES = new Set(['pending', 'deploying', 'active', 'failed', 'decommissioned'])

export const dynamic = 'force-dynamic'

function getIds(request: NextRequest) {
  return {
    projectId: getProjectIdFromRequest(request),
    deploymentId: getDeploymentIdFromRequest(request),
  }
}

export const GET = withMcpAuth('read')(async (request: NextRequest, context) => {
  const { projectId, deploymentId } = getIds(request)
  if (!projectId || !deploymentId) {
    return createMcpErrorResponse(
      new Error('Missing projectId or deploymentId'),
      'Missing parameters',
      400
    )
  }

  try {
    const deployment = await getMcpServerDeployment(context.workspaceId, projectId, deploymentId)
    if (!deployment) {
      return createMcpErrorResponse(new Error('Deployment not found'), 'Deployment not found', 404)
    }
    return createMcpSuccessResponse({ deployment })
  } catch (error) {
    logger.error(`[${context.requestId}] Failed to fetch deployment ${deploymentId}`, error)
    return createMcpErrorResponse(
      error instanceof Error ? error : new Error('Failed to fetch deployment'),
      'Failed to fetch deployment',
      500
    )
  }
})

export const PATCH = withMcpAuth('write')(async (request: NextRequest, context) => {
  const { projectId, deploymentId } = getIds(request)
  if (!projectId || !deploymentId) {
    return createMcpErrorResponse(
      new Error('Missing projectId or deploymentId'),
      'Missing parameters',
      400
    )
  }

  try {
    const body = getParsedBody(request) || (await request.json())
    const updates: Record<string, any> = {}

    if (body.status && STATUS_VALUES.has(body.status)) {
      updates.status = body.status
    }

    if ('endpointUrl' in body) {
      updates.endpointUrl = body.endpointUrl ?? null
    }

    if ('logsUrl' in body) {
      updates.logsUrl = body.logsUrl ?? null
    }

    if ('serverId' in body) {
      updates.serverId = body.serverId ?? null
    }

    if ('rolledBackAt' in body) {
      updates.rolledBackAt = body.rolledBackAt ? new Date(body.rolledBackAt) : null
    }

    if (Object.keys(updates).length === 0) {
      return createMcpErrorResponse(new Error('No valid fields to update'), 'No updates', 400)
    }

    const deployment = await updateMcpServerDeployment(
      context.workspaceId,
      projectId,
      deploymentId,
      updates
    )
    return createMcpSuccessResponse({ deployment })
  } catch (error) {
    logger.error(`[${context.requestId}] Failed to update deployment ${deploymentId}`, error)
    return createMcpErrorResponse(
      error instanceof Error ? error : new Error('Failed to update deployment'),
      error instanceof Error ? error.message : 'Failed to update deployment',
      500
    )
  }
})
