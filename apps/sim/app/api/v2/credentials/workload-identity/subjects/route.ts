import { v2CreateCredentialWorkloadIdentitySubjectContract } from '@/lib/api/contracts/v2/credentials'
import {
  createV2ResourceConcealmentPolicy,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { renderV2CredentialProviderError } from '@/lib/credentials/api/route-policies'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { prepareWorkloadIdentity } from '@/lib/credentials/application/prepare-workload-identity'
import {
  WORKLOAD_IDENTITY_KEYLESS_CONFIGS,
  workloadIdentityProviderFor,
} from '@/lib/credentials/workload-identity/audiences'
import { WorkloadIdentityNotConfiguredError } from '@/lib/credentials/workload-identity/subject'
import { v2CaughtOrchestrationError } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const workloadIdentitySubjectErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Workspace not found',
  render: (error) => renderV2CredentialProviderError(error) ?? v2CaughtOrchestrationError(error),
})

/**
 * POST /api/v2/credentials/workload-identity/subjects — Issue the subject a
 * cloud trust configuration pins, and the proof that attaches it to a new
 * keyless credential. A deployment that cannot sign is refused exactly as
 * Create service-account credential refuses a keyless configuration there.
 */
export const POST = defineV2JsonRoute({
  contract: v2CreateCredentialWorkloadIdentitySubjectContract,
  auth: v2ApiKeyAuth,
  operation: credentialOperations.prepareWorkloadIdentity,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: workloadIdentitySubjectErrorPolicy,
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    provider: workloadIdentityProviderFor(body.providerId),
  }),
  useCase: prepareWorkloadIdentity,
  present: (result, { body }) => {
    if (!result.available) {
      throw new WorkloadIdentityNotConfiguredError()
    }
    const { authType, requiredFields, optionalFields } =
      WORKLOAD_IDENTITY_KEYLESS_CONFIGS[workloadIdentityProviderFor(body.providerId)]
    return {
      data: {
        issuer: result.issuer,
        ...(result.audience ? { audience: result.audience } : {}),
        subject: result.subject,
        subjectProof: result.subjectProof,
        expiresAt: result.expiresAt,
        keylessConfig: { authType, subject: result.subject, subjectProof: result.subjectProof },
        requiredConfigFields: [...requiredFields],
        optionalConfigFields: [...optionalFields],
      },
    }
  },
})
