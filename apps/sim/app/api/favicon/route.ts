import { getFaviconContract } from '@/lib/api/contracts/favicon'
import {
  defineInternalBinaryRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import type {
  BinaryResponseDescriptor,
  NoContentResponseDescriptor,
} from '@/lib/api/server/routes/types'
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
  /** No icon is an ordinary answer, not an error: 204, which an `<img>` still reports as failed. */
  present: (favicon): BinaryResponseDescriptor | NoContentResponseDescriptor =>
    favicon.kind === 'hit'
      ? {
          body: new Uint8Array(favicon.bytes),
          contentType: favicon.contentType,
          contentLength: favicon.bytes.length,
          headers: {
            'Cache-Control': 'private, max-age=86400, stale-while-revalidate=604800',
            'X-Content-Type-Options': 'nosniff',
          },
        }
      : {
          status: 204,
          headers: {
            'Cache-Control': favicon.kind === 'miss' ? 'private, max-age=3600' : 'no-store',
          },
        },
})
