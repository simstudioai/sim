import { NextResponse } from 'next/server'
import { simMcpResourceMetadata } from '@/lib/api/mcp/oauth-metadata'
import { isAuthDisabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/** RFC 9728 metadata for the Sim MCP server; `proxy.ts` also serves it on the dedicated MCP host. */
export const GET = withRouteHandler(async () => {
  if (isAuthDisabled) return new NextResponse(null, { status: 404 })
  return simMcpResourceMetadata()
})
