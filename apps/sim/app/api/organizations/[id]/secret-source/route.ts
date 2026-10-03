import {
  configureSecretSourceContract,
  getSecretSourceContract,
  removeSecretSourceContract,
} from '@/lib/api/contracts/organization-secrets'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  configureOrganizationSecretSource,
  readOrganizationSecretSource,
  removeOrganizationSecretSource,
} from '@/lib/organization-secrets/application/use-cases'

const policy = {
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-secret-source' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
}

export const GET = defineInternalJsonRoute({
  ...policy,
  contract: getSecretSourceContract,
  operation: readOrganizationSecretSource.operation,
  useCase: readOrganizationSecretSource,
  mapInput: ({ params }) => ({ organizationId: params.id }),
})

export const PUT = defineInternalJsonRoute({
  ...policy,
  contract: configureSecretSourceContract,
  operation: configureOrganizationSecretSource.operation,
  useCase: configureOrganizationSecretSource,
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
})

export const DELETE = defineInternalJsonRoute({
  ...policy,
  contract: removeSecretSourceContract,
  operation: removeOrganizationSecretSource.operation,
  useCase: removeOrganizationSecretSource,
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
})
