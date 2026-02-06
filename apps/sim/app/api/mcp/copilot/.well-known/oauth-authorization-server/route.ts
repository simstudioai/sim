import { type NextRequest, NextResponse } from 'next/server'
import { createMcpAuthorizationServerMetadataResponse } from '@/lib/mcp/oauth-discovery'

export async function GET(request: NextRequest): Promise<NextResponse> {
  return createMcpAuthorizationServerMetadataResponse(request)
}
