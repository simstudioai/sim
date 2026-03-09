import type { NextResponse } from 'next/server'
import { createMcpAuthorizationServerMetadataResponse } from '@/lib/mcp/oauth-discovery'

export async function GET(): Promise<NextResponse> {
  return createMcpAuthorizationServerMetadataResponse()
}
