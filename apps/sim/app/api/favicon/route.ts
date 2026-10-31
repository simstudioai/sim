import { getFaviconContract } from '@/lib/api/contracts/favicon'
import {
  defineInternalBinaryRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getFavicon } from '@/lib/favicon/application'

export const GET = defineInternalBinaryRoute({
  contract: getFaviconContract,
  auth: internalSessionAuth,
  operation: getFavicon.operation,
  rateLimit: internalRateLimits.user({
    bucketName: 'favicon',
    /** A page can render dozens of icons at once; the browser caches each one after its first load. */
    config: { maxTokens: 300, refillRate: 300, refillIntervalMs: 60_000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => ({ host: query.host }),
  useCase: getFavicon,
  present: ({ bytes, contentType }) => ({
    body: new Uint8Array(bytes),
    contentType,
    contentLength: bytes.length,
    headers: {
      'Cache-Control': 'private, max-age=86400, stale-while-revalidate=604800',
      'X-Content-Type-Options': 'nosniff',
    },
  }),
})
