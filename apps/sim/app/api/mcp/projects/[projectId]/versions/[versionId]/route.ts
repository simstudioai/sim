import type { NextRequest } from 'next/server'
import {
  getMcpServerVersion,
  updateMcpServerVersion,
} from '@/lib/mcp/version-service'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import {
  getProjectIdFromRequest,
  getVersionIdFromRequest,
} from '@/lib/mcp/request-utils'
import { createLogger } from '@/lib/logs/console/logger'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('McpProjectVersionDetailsAPI')
const STATUS_VALUES = new Set(['queued', 'building', 'ready', 'failed', 'deprecated'])

export const dynamic = 'force-dynamic'

function getIds(request: NextRequest) {
  return {
    projectId: getProjectIdFromRequest(request),
    versionId: getVersionIdFromRequest(request),
  }
}

export const GET = withMcpAuth('read')(async (request: NextRequest, context) => {
  const { projectId, versionId } = getIds(request)

  if (!projectId || !versionId) {
    return createMcpErrorResponse(
      new Error('Missing projectId or versionId'),
      'Missing parameters',
      400
    )
  }

  try {
    const version = await getMcpServerVersion(context.workspaceId, projectId, versionId)
    if (!version) {
      return createMcpErrorResponse(new Error('Version not found'), 'Version not found', 404)
    }

    return createMcpSuccessResponse({ version })
  } catch (error) {
    logger.error(`[${context.requestId}] Failed to fetch version ${versionId}`, error)
    return createMcpErrorResponse(
      error instanceof Error ? error : new Error('Failed to fetch version'),
      'Failed to fetch version',
      500
    )
  }
})

export const PATCH = withMcpAuth('write')(async (request: NextRequest, context) => {
  const { projectId, versionId } = getIds(request)

  if (!projectId || !versionId) {
    return createMcpErrorResponse(
      new Error('Missing projectId or versionId'),
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

    if ('artifactUrl' in body) {
      updates.artifactUrl = body.artifactUrl ?? null
    }

    if ('runtimeMetadata' in body) {
      updates.runtimeMetadata = body.runtimeMetadata ?? {}
    }

    if ('buildLogsUrl' in body) {
      updates.buildLogsUrl = body.buildLogsUrl ?? null
    }

    if ('changelog' in body) {
      updates.changelog = body.changelog ?? null
    }

    if ('promotedBy' in body) {
      updates.promotedBy = body.promotedBy ?? null
    }

    if ('promotedAt' in body) {
      updates.promotedAt = body.promotedAt ? new Date(body.promotedAt) : null
    }

    if (Object.keys(updates).length === 0) {
      return createMcpErrorResponse(new Error('No valid fields to update'), 'No updates', 400)
    }

    const version = await updateMcpServerVersion(
      context.workspaceId,
      projectId,
      versionId,
      updates
    )
    return createMcpSuccessResponse({ version })
  } catch (error) {
    logger.error(`[${context.requestId}] Failed to update version ${versionId}`, error)
    return createMcpErrorResponse(
      error instanceof Error ? error : new Error('Failed to update version'),
      error instanceof Error ? error.message : 'Failed to update version',
      500
    )
  }
})
