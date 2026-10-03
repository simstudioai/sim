import { decryptSecret } from '@/lib/core/security/encryption'
import { authorizeOrganizationCredentialUse } from '@/lib/credentials/application/organization-credentials'
import {
  GitHubInstallationError,
  listGitHubInstallationRepositories,
  parseGitHubInstallationBinding,
  resolveGitHubInstallationRepository,
} from '@/lib/oauth/github-installation'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'
import { parseGitHubRepository } from '@/lib/oauth/github-repository'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
} from '@/lib/selectors/server/errors'
import {
  detailSelectorResult,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

export const githubSelectorAttachments = {
  'github.installationRepositories': {
    credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['github-repositories'] },
    destination: 'fixed',
    async execute(args) {
      if (
        args.scope.kind !== 'organization' ||
        args.workspaceId ||
        args.organizationId !== args.scope.organizationId ||
        !args.credential?.organization ||
        args.credential.providerId !== GITHUB_INSTALLATION_PROVIDER_ID
      )
        throw new SelectorContextUnavailableError()
      const page = args.request.kind === 'list' ? Number(args.request.cursor ?? '1') : 1
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        page > 100 ||
        (args.request.kind === 'list' &&
          args.request.cursor !== undefined &&
          String(page) !== args.request.cursor)
      )
        throw new SelectorContextUnavailableError()
      const { credential } = await authorizeOrganizationCredentialUse({
        ...args.credential.organization,
        credentialId: args.credential.suppliedId,
        expectedProviderId: GITHUB_INSTALLATION_PROVIDER_ID,
        requestId: 'selector-execution',
        purpose: 'browsing',
      })
      if (
        credential.type !== 'service_account' ||
        credential.organizationId !== args.scope.organizationId ||
        credential.workspaceId !== null ||
        !credential.encryptedServiceAccountKey ||
        credential.encryptedServiceAccountKey.length > 16_384
      )
        throw new SelectorConnectionUnavailableError()
      const { decrypted } = await decryptSecret(credential.encryptedServiceAccountKey)
      args.protectedValues.add(decrypted)
      const binding = parseGitHubInstallationBinding(JSON.parse(decrypted))
      if (
        binding.installationId !== credential.providerSubjectId ||
        binding.accountId !== credential.providerTenantId
      )
        throw new SelectorConnectionUnavailableError()
      try {
        if (args.request.kind === 'detail') {
          try {
            parseGitHubRepository(args.request.id)
          } catch {
            return detailSelectorResult(null)
          }
          const repository = await resolveGitHubInstallationRepository(binding, args.request.id, {
            signal: args.signal,
          })
          return detailSelectorResult({ id: repository.fullName, label: repository.fullName })
        }
        const result = await listGitHubInstallationRepositories(binding, {
          page,
          signal: args.signal,
        })
        return listSelectorResult(
          result.repositories.map((repository) => ({
            id: repository.fullName,
            label: repository.fullName,
          })),
          result.hasMore && page < 100 ? String(page + 1) : undefined,
          result.hasMore && page === 100
            ? { truncated: { reason: 'provider-cap', pages: 100 } }
            : undefined
        )
      } catch (error) {
        if (args.signal?.aborted) throw error
        if (error instanceof GitHubInstallationError) throw new SelectorConnectionUnavailableError()
        throw error
      }
    },
  },
} satisfies ServerSelectorAttachmentMap<'github.installationRepositories'>
