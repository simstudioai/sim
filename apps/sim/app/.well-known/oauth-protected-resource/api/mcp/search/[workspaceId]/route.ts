import { type NextRequest, NextResponse } from 'next/server'
import { knowledgeMcpParamsSchema } from '@/lib/api/contracts/knowledge/mcp'
import { isAuthDisabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { searchMcpResourceMetadata } from '@/lib/knowledge/mcp/oauth-metadata'
import { getSearchMcpUrl } from '@/lib/knowledge/mcp/urls'

export const GET = withRouteHandler(
  async (_request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) => {
    if (isAuthDisabled) return new NextResponse(null, { status: 404 })
    const parsed = knowledgeMcpParamsSchema.safeParse(await context.params)
    if (!parsed.success) return new NextResponse(null, { status: 404 })
    return searchMcpResourceMetadata(getSearchMcpUrl('workspace', parsed.data.workspaceId))
  }
)
