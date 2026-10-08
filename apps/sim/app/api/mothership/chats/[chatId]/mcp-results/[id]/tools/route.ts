import { callMcpAppToolContract } from '@/lib/api/contracts/mcp-presentations'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalOrchestrationErrorPolicy } from '@/lib/api/server/routes/internal-json-route'
import { callMcpAppTool } from '@/lib/mothership/chat/application/mcp-results'

export const dynamic = 'force-dynamic'
export const POST = defineInternalJsonRoute({
  contract: callMcpAppToolContract,
  auth: internalSessionAuth,
  operation: callMcpAppTool.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'mcp-apps' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }, { request }) => ({ ...params, ...body, signal: request.signal }),
  parseOptions: { maxBodyBytes: 256 * 1024 },
  useCase: callMcpAppTool,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
