import { getMcpPresentationContract } from '@/lib/api/contracts/mcp-presentations'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalOrchestrationErrorPolicy } from '@/lib/api/server/routes/internal-json-route'
import { readMcpResult } from '@/lib/mothership/chat/application/mcp-results'

export const dynamic = 'force-dynamic'
export const GET = defineInternalJsonRoute({
  contract: getMcpPresentationContract,
  auth: internalSessionAuth,
  operation: readMcpResult.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'mcp-apps' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: readMcpResult,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
