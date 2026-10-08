import { getMcpAppFrameContract } from '@/lib/api/contracts/mcp-presentations'
import {
  defineInternalBinaryRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalOrchestrationErrorPolicy } from '@/lib/api/server/routes/internal-json-route'
import { readMcpAppFrame } from '@/lib/mothership/chat/application/mcp-results'

export const dynamic = 'force-dynamic'
export const GET = defineInternalBinaryRoute({
  contract: getMcpAppFrameContract,
  auth: internalSessionAuth,
  operation: readMcpAppFrame.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'mcp-apps' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: readMcpAppFrame,
  present: ({ buffer, contentType, policy }) => ({
    body: new Uint8Array(buffer),
    contentType,
    contentLength: buffer.length,
    headers: {
      'Content-Security-Policy': policy,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  }),
})
