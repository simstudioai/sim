import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret } from '@/lib/core/security/encryption'
import { canUseCredential, getCredentialActorContext } from '@/lib/credentials/access'
import {
  parseGitHubInstallationBinding,
  resolveGitHubInstallationRepository,
} from '@/lib/oauth/github-installation'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'

interface GitHubInstallationSourceInput {
  connectorType: string
  credentialId?: string | null
  organizationId?: string
  isSearchIndex: boolean
  accessMode: string
  actingUserId: string
  sourceConfig: Record<string, unknown>
  previousConfig?: Record<string, unknown>
}

/** Pins installation sources to a provider-verified repository identity before persisting them. */
export async function prepareGitHubInstallationSource(
  input: GitHubInstallationSourceInput
): Promise<Record<string, unknown>> {
  const wasInstallation = input.previousConfig?.githubRepositoryId !== undefined
  const assertedId = input.sourceConfig.githubRepositoryId
  if (input.connectorType !== 'github') {
    if (assertedId !== undefined)
      throw new OrchestrationError(
        'validation',
        'githubRepositoryId is reserved for GitHub installation sources'
      )
    return input.sourceConfig
  }
  const access = input.credentialId
    ? await getCredentialActorContext(input.credentialId, input.actingUserId)
    : null
  const contentCredential = access?.credential
  if (contentCredential?.providerId !== GITHUB_INSTALLATION_PROVIDER_ID) {
    if (wasInstallation || assertedId !== undefined)
      throw new OrchestrationError(
        'validation',
        'This source requires its GitHub installation. Create a new source to change the indexing method.'
      )
    return input.sourceConfig
  }
  if (!input.organizationId || !input.isSearchIndex || input.accessMode !== 'members')
    throw new OrchestrationError(
      'validation',
      'GitHub installations require organization Search with connected member access'
    )
  if (
    !access ||
    !canUseCredential(access) ||
    contentCredential.organizationId !== input.organizationId ||
    contentCredential.workspaceId !== null ||
    contentCredential.type !== 'service_account' ||
    contentCredential.revokedAt ||
    !contentCredential.encryptedServiceAccountKey
  )
    throw new OrchestrationError(
      'forbidden',
      'This GitHub installation is not available in this organization'
    )
  if (contentCredential.encryptedServiceAccountKey.length > 16_384)
    throw new OrchestrationError('validation', 'Reconnect this GitHub installation before using it')
  const repository = input.sourceConfig.repository
  if (typeof repository !== 'string' || !repository.trim())
    throw new OrchestrationError('validation', 'Choose a GitHub repository for this source')
  const { decrypted } = await decryptSecret(contentCredential.encryptedServiceAccountKey)
  const binding = parseGitHubInstallationBinding(JSON.parse(decrypted))
  if (
    binding.installationId !== contentCredential.providerSubjectId ||
    binding.accountId !== contentCredential.providerTenantId
  )
    throw new OrchestrationError('validation', 'Reconnect this GitHub installation before using it')
  const resolved = await resolveGitHubInstallationRepository(binding, repository.trim())
  if (wasInstallation && input.previousConfig?.githubRepositoryId !== resolved.id)
    throw new OrchestrationError(
      'validation',
      'Create a new source to index a different GitHub repository'
    )
  return { ...input.sourceConfig, repository: resolved.fullName, githubRepositoryId: resolved.id }
}
