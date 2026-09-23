import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret } from '@/lib/core/security/encryption'
import {
  credentialGroupApiKeyNameSchema,
  credentialGroupApiKeyValueSchema,
} from '@/lib/credential-groups/api-key-validation'
import {
  listCredentialGroupApiKeyReferences,
  loadCredentialGroupApiKey,
} from '@/lib/credential-groups/api-keys'
import {
  credentialGroupDelegationPolicy,
  requireCredentialGroupWorkflowActor,
} from '@/lib/credential-groups/application/authorization'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import {
  type OrganizationAccountsWorkspaceContext,
  requireOrganizationAccountsWorkspaceAccess,
  resolveOrganizationAccountsWorkspaceContext,
} from '@/lib/credential-groups/application/organization-workspace-access'
import { validateCredentialGroupEnrollmentPage } from '@/lib/credential-groups/application/validation'

interface ListApiKeysInput {
  workspaceId: string
  keyName?: string
  email?: string
  limit: number
  cursor?: string
}

function requireActiveGroup(context: OrganizationAccountsWorkspaceContext): void {
  if (context.status !== 'active')
    throw new OrchestrationError('conflict', 'Credential group is disabled')
}

export const listCredentialGroupApiKeys = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.listApiKeys,
  resolveContext: ({ input }: { input: ListApiKeysInput }) =>
    resolveOrganizationAccountsWorkspaceContext(input.workspaceId),
  authorizationOptions: { delegation: credentialGroupDelegationPolicy },
  async authorizeResource({ principal, context }) {
    requireCredentialGroupWorkflowActor(principal)
    await requireOrganizationAccountsWorkspaceAccess(context, 'api_key')
    requireActiveGroup(context)
  },
  async execute({ context, input }) {
    validateCredentialGroupEnrollmentPage(input.limit)
    const keyName =
      input.keyName === undefined
        ? undefined
        : credentialGroupApiKeyNameSchema.safeParse(input.keyName)
    if (keyName && !keyName.success)
      throw new OrchestrationError('validation', 'API key name must contain 1 to 100 characters')
    const email = input.email === undefined ? undefined : normalizeEmail(input.email)
    if (email !== undefined && !isValidEmailSyntax(email))
      throw new OrchestrationError('validation', 'Email must be a valid address')
    if (input.cursor !== undefined && (!input.cursor.trim() || input.cursor.length > 128))
      throw new OrchestrationError('validation', 'API key cursor is invalid')
    return listCredentialGroupApiKeyReferences(context, {
      limit: input.limit,
      cursor: input.cursor,
      keyName: keyName?.success ? keyName.data : undefined,
      email,
    })
  },
})

export const getCredentialGroupApiKey = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.getApiKey,
  resolveContext: ({ input }: { input: { workspaceId: string; credentialId: string } }) =>
    resolveOrganizationAccountsWorkspaceContext(input.workspaceId),
  authorizationOptions: { delegation: credentialGroupDelegationPolicy },
  async authorizeResource({ principal, context }) {
    requireCredentialGroupWorkflowActor(principal)
    await requireOrganizationAccountsWorkspaceAccess(context, 'api_key')
    requireActiveGroup(context)
  },
  async execute({ context, input }) {
    if (!input.credentialId.trim() || input.credentialId.length > 128)
      throw new OrchestrationError('validation', 'API key credential ID is invalid')
    const resolved = await loadCredentialGroupApiKey(context, input.credentialId)
    const { decrypted } = await decryptSecret(resolved.encryptedValue)
    if (!credentialGroupApiKeyValueSchema.safeParse(decrypted).success)
      throw new Error('Stored API key cannot be protected by secret provenance')
    return { ...resolved, apiKey: decrypted }
  },
})
