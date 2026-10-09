import { getMcpPresentationAssetContract } from '@/lib/api/contracts/mcp-presentations'
import {
  defineInternalBinaryRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalOrchestrationErrorPolicy } from '@/lib/api/server/routes/internal-json-route'
import { readMcpResultAsset } from '@/lib/mothership/chat/application/mcp-results'

export const dynamic = 'force-dynamic'
export const GET = defineInternalBinaryRoute({
  contract: getMcpPresentationAssetContract,
  auth: internalSessionAuth,
  operation: readMcpResultAsset.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'mcp-apps' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: readMcpResultAsset,
  present: ({ buffer, contentType, disposition }) => ({
    body: new Uint8Array(buffer),
    contentType,
    contentLength: buffer.length,
    contentDisposition: disposition,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    },
  }),
})
