import {
  configurePeopleSyncContract,
  disconnectPeopleSyncContract,
  getPeopleSyncContract,
} from '@/lib/api/contracts/people-sync'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  configurePeopleSync,
  disconnectPeopleSync,
  getPeopleSync,
} from '@/lib/people/application/directory-sync'

export const maxDuration = 180

const common = {
  auth: internalSessionAuth,
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
} as const

export const GET = defineInternalJsonRoute({
  ...common,
  contract: getPeopleSyncContract,
  operation: getPeopleSync.operation,
  useCase: getPeopleSync,
  rateLimit: internalRateLimits.user({ bucketName: 'people-sync-status' }),
  mapInput: ({ params }) => ({ organizationId: params.id }),
})

export const PUT = defineInternalJsonRoute({
  ...common,
  contract: configurePeopleSyncContract,
  operation: configurePeopleSync.operation,
  useCase: configurePeopleSync,
  rateLimit: internalRateLimits.user({
    bucketName: 'people-sync-configure',
    config: { maxTokens: 5, refillRate: 2, refillIntervalMs: 60000 },
  }),
  mapInput: ({ params, body }) => ({ organizationId: params.id, config: body }),
})

export const DELETE = defineInternalJsonRoute({
  ...common,
  contract: disconnectPeopleSyncContract,
  operation: disconnectPeopleSync.operation,
  useCase: disconnectPeopleSync,
  rateLimit: internalRateLimits.user({ bucketName: 'people-sync-disconnect' }),
  mapInput: ({ params }) => ({ organizationId: params.id }),
})
