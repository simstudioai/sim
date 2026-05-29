import type { NextRequest } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  copilotMcpDeprecatedJsonRpcResponse,
  copilotMcpDeprecatedResponse,
} from '@/lib/mcp/copilot-deprecated'

export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(async () => copilotMcpDeprecatedResponse())

export const POST = withRouteHandler(async (request: NextRequest) => {
  void request
  return copilotMcpDeprecatedJsonRpcResponse()
})

export const DELETE = withRouteHandler(async () => copilotMcpDeprecatedJsonRpcResponse())
