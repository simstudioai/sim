import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GitHubInstallationError } from '@/lib/oauth/github-installation'

/** Maps repository selection refusals while preserving provider failures for their caller. */
export function rethrowGitHubInstallationSourceError(error: unknown): never {
  if (
    error instanceof GitHubInstallationError &&
    ((error.operation === 'repository-token' && error.status === 422) ||
      (error.operation === 'repository' && error.status === 404))
  ) {
    throw new OrchestrationError(
      'validation',
      'Check that the repository is included in the selected GitHub App installation, then retry.'
    )
  }
  throw error
}
