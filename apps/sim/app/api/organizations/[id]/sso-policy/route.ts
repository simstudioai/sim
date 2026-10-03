import {
  getOrganizationSsoPolicyContract,
  updateOrganizationSsoPolicyContract,
} from '@/lib/api/contracts/organization'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  readSsoRequirement,
  readSsoRequirementOperation,
  type SsoRequirement,
  setSsoRequirement,
  setSsoRequirementOperation,
} from '@/lib/auth/sso/application/sso-requirement'

const present = (requirement: SsoRequirement) => ({ success: true as const, data: requirement })

/** Whether members must sign in through the organization's identity provider. */
export const GET = defineInternalJsonRoute({
  contract: getOrganizationSsoPolicyContract,
  auth: internalSessionAuth,
  operation: readSsoRequirementOperation,
  rateLimit: internalRateLimits.none({ reason: 'Settings read behind organization membership' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: readSsoRequirement,
  present,
})

/** Turns the requirement on or off. Never ends a session that already exists. */
export const PUT = defineInternalJsonRoute({
  contract: updateOrganizationSsoPolicyContract,
  auth: internalSessionAuth,
  operation: setSsoRequirementOperation,
  rateLimit: internalRateLimits.user({ bucketName: 'sso-set-requirement' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, requireSso: body.requireSso }),
  useCase: setSsoRequirement,
  present,
})
