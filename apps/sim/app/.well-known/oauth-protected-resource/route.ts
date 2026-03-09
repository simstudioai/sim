import type { NextResponse } from 'next/server'
import { createMcpProtectedResourceMetadataResponse } from '@/lib/mcp/oauth-discovery'

export async function GET(): Promise<NextResponse> {
  return createMcpProtectedResourceMetadataResponse()
}
