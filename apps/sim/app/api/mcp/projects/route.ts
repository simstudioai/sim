import type { NextRequest } from 'next/server'
import { createMcpServerProject, listMcpServerProjects } from '@/lib/mcp/project-service'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('McpProjectsAPI')
export const dynamic = 'force-dynamic'

const VISIBILITY_VALUES = new Set(['private', 'workspace', 'public'])
const SOURCE_TYPE_VALUES = new Set(['inline', 'repo', 'package'])

/**
 * GET - List all MCP server projects for a workspace
 */
export const GET = withMcpAuth('read')(async (_request, { workspaceId, requestId }) => {
  try {
    logger.info(`[${requestId}] Listing MCP server projects for workspace ${workspaceId}`)
    const projects = await listMcpServerProjects(workspaceId)
    return createMcpSuccessResponse({ projects })
  } catch (error) {
    logger.error(`[${requestId}] Failed to list MCP server projects`, error)
    return createMcpErrorResponse(
      error instanceof Error ? error : new Error('Failed to list MCP server projects'),
      'Failed to list MCP server projects',
      500
    )
  }
})

/**
 * POST - Create a new MCP server project
 */
export const POST = withMcpAuth('write')(async (request: NextRequest, authContext) => {
  const { userId, workspaceId, requestId } = authContext

  try {
    const body = getParsedBody(request) || (await request.json())

    if (!body?.name) {
      return createMcpErrorResponse(new Error('Project name is required'), 'Missing name', 400)
    }

    const visibility = VISIBILITY_VALUES.has(body.visibility)
      ? body.visibility
      : undefined
    const sourceType = SOURCE_TYPE_VALUES.has(body.sourceType)
      ? body.sourceType
      : undefined

    const project = await createMcpServerProject({
      workspaceId,
      createdBy: userId,
      name: body.name,
      slug: body.slug,
      description: body.description,
      visibility,
      runtime: body.runtime,
      entryPoint: body.entryPoint,
      template: body.template,
      sourceType,
      repositoryUrl: body.repositoryUrl,
      repositoryBranch: body.repositoryBranch,
      environmentVariables: body.environmentVariables,
      metadata: body.metadata,
    })

    logger.info(`[${requestId}] Created MCP server project ${project.id}`)
    return createMcpSuccessResponse({ project }, 201)
  } catch (error) {
    logger.error(`[${requestId}] Failed to create MCP server project`, error)
    return createMcpErrorResponse(
      error instanceof Error ? error : new Error('Failed to create MCP server project'),
      error instanceof Error ? error.message : 'Failed to create MCP server project',
      500
    )
  }
})
