import type { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createMcpAuthorizationServerMetadataResponse } from '@/lib/mcp/oauth-discovery'

const metadataQuerySchema = z.record(z.string(), z.string())

export async function GET(request: NextRequest): Promise<NextResponse> {
  metadataQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams))

  return createMcpAuthorizationServerMetadataResponse()
}
