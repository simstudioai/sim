import { getBaseUrl } from '@/lib/core/utils/urls'
import type { CredentialGroupOAuthFailure } from '@/lib/credential-groups/oauth-completion'

export function githubSetupPageUrl(scope: { organizationId: string; setupId: string }) {
  const url = new URL('/knowledge/github/setup', getBaseUrl())
  url.searchParams.set('organizationId', scope.organizationId)
  url.searchParams.set('setupId', scope.setupId)
  return url.toString()
}

export function githubSetupContinueUrl(
  scope: { organizationId: string; setupId: string },
  oauth?: CredentialGroupOAuthFailure
) {
  const url = new URL('/api/knowledge/github/setup/continue', getBaseUrl())
  url.searchParams.set('organizationId', scope.organizationId)
  url.searchParams.set('setupId', scope.setupId)
  if (oauth) url.searchParams.set('oauth', oauth)
  return url.toString()
}

export function githubSetupCompletionUrl(setupId: string, oauth?: CredentialGroupOAuthFailure) {
  const url = new URL('/credential-groups/complete', getBaseUrl())
  url.searchParams.set('completionId', setupId)
  if (oauth) url.searchParams.set('oauth', oauth)
  return url.toString()
}
