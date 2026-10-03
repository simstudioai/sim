import { listAuthorizedAppsContract } from '@/lib/api/contracts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listAuthorizedAppsUseCase } from '@/lib/users/application/authorized-apps'
import { userAccountOperations } from '@/lib/users/application/operations'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: listAuthorizedAppsContract,
  auth: internalSessionAuth,
  operation: userAccountOperations.readAuthorizedApps,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated current-user settings read',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listAuthorizedAppsUseCase,
  present: ({ apps, nextCursor }) => ({
    apps: apps.map((app) => ({
      ...app,
      name: app.name?.trim() || app.clientId,
      authorizedAt: app.authorizedAt.toISOString(),
    })),
    nextCursor,
  }),
})
