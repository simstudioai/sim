import {
  readAssistantToolPermissionsContract,
  updateAssistantToolPermissionsContract,
} from '@/lib/api/contracts/assistant-actions'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { assistantActionOperations } from '@/lib/assistant-actions/application/operations'
import {
  readOrganizationToolPermissions,
  updateOrganizationToolPermissions,
} from '@/lib/assistant-actions/application/tool-permissions'

export const GET = defineInternalJsonRoute({
  contract: readAssistantToolPermissionsContract,
  auth: internalSessionAuth,
  operation: assistantActionOperations.readPermissions,
  rateLimit: internalRateLimits.user({ bucketName: 'assistant-tool-permissions-read' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id, credentialId: params.credentialId }),
  useCase: readOrganizationToolPermissions,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})

export const PATCH = defineInternalJsonRoute({
  contract: updateAssistantToolPermissionsContract,
  auth: internalSessionAuth,
  operation: assistantActionOperations.updatePermissions,
  rateLimit: internalRateLimits.user({ bucketName: 'assistant-tool-permissions-update' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    credentialId: params.credentialId,
    ...body,
  }),
  useCase: updateOrganizationToolPermissions,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
