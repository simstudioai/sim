import { suggestSimLinksContract } from '@/lib/api/contracts/sim-links'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { suggestSimLinks } from '@/lib/sim-links/application/use-cases'

export const GET = defineInternalJsonRoute({
  contract: suggestSimLinksContract,
  operation: suggestSimLinks.operation,
  useCase: suggestSimLinks,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({
    bucketName: 'sim-link-suggestions',
    // The address bar asks again as each character is typed.
    config: { maxTokens: 120, refillRate: 120, refillIntervalMs: 60_000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
  mapInput: ({ query }) => ({ query: query.q }),
  present: (links) => ({ links }),
})
