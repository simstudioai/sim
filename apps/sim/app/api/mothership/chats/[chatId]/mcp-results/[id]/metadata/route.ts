import { getMcpPresentationMetadataContract } from '@/lib/api/contracts/mcp-presentations'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalOrchestrationErrorPolicy } from '@/lib/api/server/routes/internal-json-route'
import { readMcpResultMetadata } from '@/lib/mothership/chat/application/mcp-results'

export const dynamic = 'force-dynamic'
export const GET = defineInternalJsonRoute({
  contract: getMcpPresentationMetadataContract,
  auth: internalSessionAuth,
  operation: readMcpResultMetadata.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'mcp-apps' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: readMcpResultMetadata,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
