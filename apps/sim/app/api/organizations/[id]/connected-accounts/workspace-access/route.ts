import {
  getOrganizationAccountWorkspaceAccessContract,
  updateOrganizationAccountWorkspaceAccessContract,
} from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  getOrganizationAccountWorkspaceAccess,
  organizationAccountAccessOperations,
  updateOrganizationAccountWorkspaceAccess,
} from '@/lib/credential-groups/application/organization-access'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationAccountWorkspaceAccessContract,
  auth: internalSessionAuth,
  operation: organizationAccountAccessOperations.read,
  rateLimit: internalRateLimits.none({
    reason: 'Bounded administrator workspace access settings read',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: getOrganizationAccountWorkspaceAccess,
})

export const PUT = defineInternalJsonRoute({
  contract: updateOrganizationAccountWorkspaceAccessContract,
  auth: internalSessionAuth,
  operation: organizationAccountAccessOperations.update,
  rateLimit: internalRateLimits.none({
    reason: 'Administrator policy revision protects bounded workspace access updates',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  useCase: updateOrganizationAccountWorkspaceAccess,
  present: ({ revision, workspaceIds }) => ({ revision, workspaceIds }),
})
