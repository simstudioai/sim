import type { NextRequest, NextResponse } from 'next/server'
import { mcpOauthProtectedResourceMetadataContract } from '@/lib/api/contracts/mcp-oauth'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createMcpProtectedResourceMetadataResponse } from '@/lib/mcp/oauth-discovery'

export const GET = withRouteHandler(async (request: NextRequest): Promise<NextResponse> => {
  const parsed = await parseRequest(mcpOauthProtectedResourceMetadataContract, request, {})
  if (!parsed.success) return parsed.response as NextResponse

  return createMcpProtectedResourceMetadataResponse()
})
