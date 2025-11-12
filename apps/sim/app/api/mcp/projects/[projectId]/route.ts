import type { NextRequest } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  archiveMcpServerProject,
  getMcpServerProject,
  updateMcpServerProject,
} from '@/lib/mcp/project-service'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { getProjectIdFromRequest } from '@/lib/mcp/request-utils'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('McpProjectDetailsAPI')
const VISIBILITY_VALUES = new Set(['private', 'workspace', 'public'])
const SOURCE_TYPE_VALUES = new Set(['inline', 'repo', 'package'])
const STATUS_VALUES = new Set(['draft', 'building', 'deploying', 'active', 'failed', 'archived'])

export const dynamic = 'force-dynamic'

export const GET = withMcpAuth('read')(async (request: NextRequest, context) => {
  const { workspaceId, requestId } = context
  const projectId = getProjectIdFromRequest(request)

  try {
    if (!projectId) {
      return createMcpErrorResponse(new Error('Project ID missing from URL'), 'Missing projectId', 400)
    }

    const project = await getMcpServerProject(workspaceId, projectId)
    if (!project) {
      return createMcpErrorResponse(new Error('Project not found'), 'Project not found', 404)
    }

    return createMcpSuccessResponse({ project })
  } catch (error) {
    logger.error(`[${requestId}] Failed to fetch MCP project ${projectId}`, error)
    return createMcpErrorResponse(
      error instanceof Error ? error : new Error('Failed to fetch project'),
      'Failed to fetch project',
      500
    )
  }
})

export const PATCH = withMcpAuth('write')(async (request: NextRequest, context) => {
  const { workspaceId, requestId } = context
  const projectId = getProjectIdFromRequest(request)

  try {
    if (!projectId) {
      return createMcpErrorResponse(new Error('Project ID missing from URL'), 'Missing projectId', 400)
    }

    const body = getParsedBody(request) || (await request.json())
    const updates: Record<string, any> = {}

    if (typeof body.name === 'string') {
      updates.name = body.name
    }

    if ('description' in body) {
      updates.description = body.description ?? null
    }

    if (body.visibility && VISIBILITY_VALUES.has(body.visibility)) {
      updates.visibility = body.visibility
    }

    if (body.runtime) {
      updates.runtime = body.runtime
    }

    if (body.entryPoint) {
      updates.entryPoint = body.entryPoint
    }

    if ('template' in body) {
      updates.template = body.template ?? null
    }

    if (body.sourceType && SOURCE_TYPE_VALUES.has(body.sourceType)) {
      updates.sourceType = body.sourceType
    }

    if ('repositoryUrl' in body) {
      updates.repositoryUrl = body.repositoryUrl ?? null
    }

    if ('repositoryBranch' in body) {
      updates.repositoryBranch = body.repositoryBranch ?? null
    }

    if (body.environmentVariables && typeof body.environmentVariables === 'object') {
      updates.environmentVariables = body.environmentVariables
    }

    if (body.metadata && typeof body.metadata === 'object') {
      updates.metadata = body.metadata
    }

    if (body.status && STATUS_VALUES.has(body.status)) {
      updates.status = body.status
    }

    if (Object.keys(updates).length === 0) {
      return createMcpErrorResponse(new Error('No valid fields to update'), 'No updates', 400)
    }

    const project = await updateMcpServerProject(workspaceId, projectId, updates)
    return createMcpSuccessResponse({ project })
  } catch (error) {
    logger.error(`[${requestId}] Failed to update MCP project ${projectId}`, error)
    return createMcpErrorResponse(
      error instanceof Error ? error : new Error('Failed to update project'),
      error instanceof Error ? error.message : 'Failed to update project',
      500
    )
  }
})

export const DELETE = withMcpAuth('admin')(async (request: NextRequest, context) => {
  const { workspaceId, requestId } = context
  const projectId = getProjectIdFromRequest(request)

  try {
    if (!projectId) {
      return createMcpErrorResponse(new Error('Project ID missing from URL'), 'Missing projectId', 400)
    }

    await archiveMcpServerProject(workspaceId, projectId)
    logger.info(`[${requestId}] Archived MCP project ${projectId}`)
    return createMcpSuccessResponse({ projectId })
  } catch (error) {
    logger.error(`[${requestId}] Failed to archive MCP project ${projectId}`, error)
    return createMcpErrorResponse(
      error instanceof Error ? error : new Error('Failed to archive project'),
      error instanceof Error ? error.message : 'Failed to archive project',
      500
    )
  }
})
