import { listChangelogReleasesContract } from '@/lib/api/contracts/changelog'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listChangelogReleases } from '@/lib/changelog/application/changelog'
import { changelogOperations } from '@/lib/changelog/application/operations'

export const GET = defineInternalJsonRoute({
  contract: listChangelogReleasesContract,
  auth: internalSessionAuth,
  operation: changelogOperations.read,
  rateLimit: internalRateLimits.user({ bucketName: 'changelog' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ workspaceId: params.id, cursor: query.cursor }),
  useCase: listChangelogReleases,
})
