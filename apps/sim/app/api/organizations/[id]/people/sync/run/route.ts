import { runPeopleSyncContract } from '@/lib/api/contracts/people-sync'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { runPeopleSync } from '@/lib/people/application/directory-sync'

export const maxDuration = 180

export const POST = defineInternalJsonRoute({
  contract: runPeopleSyncContract,
  operation: runPeopleSync.operation,
  useCase: runPeopleSync,
  auth: internalSessionAuth,
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
  rateLimit: internalRateLimits.user({
    bucketName: 'people-sync-run',
    config: { maxTokens: 5, refillRate: 2, refillIntervalMs: 60000 },
  }),
  mapInput: ({ params }) => ({ organizationId: params.id }),
})
