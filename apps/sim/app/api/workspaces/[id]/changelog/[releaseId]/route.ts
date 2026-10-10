import { updateChangelogReleaseContract } from '@/lib/api/contracts/changelog'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { updateChangelogRelease } from '@/lib/changelog/application/changelog'
import { changelogOperations } from '@/lib/changelog/application/operations'

export const PATCH = defineInternalJsonRoute({
  contract: updateChangelogReleaseContract,
  auth: internalSessionAuth,
  operation: changelogOperations.update,
  rateLimit: internalRateLimits.user({ bucketName: 'changelog' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    releaseId: params.releaseId,
    expectedRevision: body.expectedRevision,
    title: body.title,
    bumpReason: body.bumpReason,
    version: body.version,
  }),
  useCase: updateChangelogRelease,
})
