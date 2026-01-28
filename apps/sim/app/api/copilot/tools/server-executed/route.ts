import { NextResponse } from 'next/server'
import { SERVER_EXECUTED_TOOLS } from '@/lib/copilot/server-executor/registry'

/**
 * GET /api/copilot/tools/server-executed
 *
 * Returns the list of tools that are executed server-side.
 * Clients can use this to avoid double-executing these tools.
 */
export async function GET() {
  return NextResponse.json({
    tools: SERVER_EXECUTED_TOOLS,
  })
}
