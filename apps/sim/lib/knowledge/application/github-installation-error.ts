import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GitHubInstallationError } from '@/lib/oauth/github-installation'

/** Maps repository selection refusals while preserving provider failures for their caller. */
export function rethrowGitHubInstallationSourceError(
  error: unknown,
  { existingSource = false }: { existingSource?: boolean } = {}
): never {
  if (
    error instanceof GitHubInstallationError &&
    ((error.operation === 'repository-token' && error.status === 422) ||
      (error.operation === 'repository' && error.status === 404))
  ) {
    throw new OrchestrationError(
      'validation',
      existingSource
        ? "This GitHub connection cannot access this source's repository. Choose a connection with access to the same repository, or add a new source for a different repository."
        : 'Check that the repository is included in the selected GitHub App installation, then retry.'
    )
  }
  throw error
}
