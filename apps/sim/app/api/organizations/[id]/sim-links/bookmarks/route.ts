import { exportSimBookmarksContract } from '@/lib/api/contracts/sim-links'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { exportSimBookmarks } from '@/lib/sim-links/application/use-cases'

export const POST = defineInternalJsonRoute({
  contract: exportSimBookmarksContract,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({ bucketName: 'sim-links' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
  operation: exportSimBookmarks.operation,
  useCase: exportSimBookmarks,
  mapInput: ({ params, body }) => ({ organizationId: params.id, links: body.links }),
  present: (links) => ({ links }),
})
