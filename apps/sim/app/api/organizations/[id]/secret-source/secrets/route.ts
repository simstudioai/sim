import {
  getOrganizationSecretsContract,
  saveOrganizationSecretsContract,
} from '@/lib/api/contracts/organization-secrets'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  readOrganizationSecrets,
  saveOrganizationSecrets,
} from '@/lib/organization-secrets/application/use-cases'

const policy = {
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-secrets' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
}

export const GET = defineInternalJsonRoute({
  ...policy,
  contract: getOrganizationSecretsContract,
  operation: readOrganizationSecrets.operation,
  useCase: readOrganizationSecrets,
  mapInput: ({ params, query }) => ({ organizationId: params.id, ...query }),
})

export const PATCH = defineInternalJsonRoute({
  ...policy,
  contract: saveOrganizationSecretsContract,
  operation: saveOrganizationSecrets.operation,
  useCase: saveOrganizationSecrets,
  parseOptions: { maxBodyBytes: 2 * 1024 * 1024 },
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  present: () => ({ success: true as const }),
})
