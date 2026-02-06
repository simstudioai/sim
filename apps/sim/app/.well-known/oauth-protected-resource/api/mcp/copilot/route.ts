import { type NextRequest, NextResponse } from 'next/server'
import { createMcpProtectedResourceMetadataResponse } from '@/lib/mcp/oauth-discovery'

export async function GET(request: NextRequest): Promise<NextResponse> {
  return createMcpProtectedResourceMetadataResponse(request)
}
