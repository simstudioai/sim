import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { copilotMcpDeprecatedResponse } from '@/lib/mcp/copilot-deprecated'

export const GET = withRouteHandler(async () => copilotMcpDeprecatedResponse())
