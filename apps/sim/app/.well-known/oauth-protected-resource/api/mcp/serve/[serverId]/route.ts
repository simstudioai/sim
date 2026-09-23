import { type NextRequest, NextResponse } from 'next/server'
import { mcpServeRouteParamsSchema } from '@/lib/api/contracts/mcp'
import { isAuthDisabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { workflowMcpResourceMetadata } from '@/lib/mcp/oauth-metadata'

/**
 * RFC 9728 metadata for a workflow MCP server. Public protocol metadata, so it
 * describes the endpoint without looking the server up.
 */
export const GET = withRouteHandler(
  async (_request: NextRequest, context: { params: Promise<{ serverId: string }> }) => {
    if (isAuthDisabled) return new NextResponse(null, { status: 404 })
    const parsed = mcpServeRouteParamsSchema.safeParse(await context.params)
    if (!parsed.success) return new NextResponse(null, { status: 404 })
    return workflowMcpResourceMetadata(parsed.data.serverId)
  }
)
