import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  copilotMcpDeprecatedJsonRpcResponse,
  copilotMcpDeprecatedResponse,
} from '@/lib/mcp/copilot-deprecated'

export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(async () => copilotMcpDeprecatedResponse())

export const POST = withRouteHandler(async () => copilotMcpDeprecatedJsonRpcResponse())

export const DELETE = withRouteHandler(async () => copilotMcpDeprecatedJsonRpcResponse())
