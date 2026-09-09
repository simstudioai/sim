/** Installation credentials supply repository content, never a person's access grants. */
export const GITHUB_INSTALLATION_PROVIDER_ID = 'github-app-installation' as const

export interface GitHubInstallationSummary {
  appId: string
  appClientId: string
  installationId: string
  accountId: string
  accountType: 'User' | 'Organization'
  accountLogin: string
  repositorySelection: 'all' | 'selected'
}

/** Provider-verified installation identity; the application's signing key stays server-owned. */
export interface GitHubInstallationBinding extends GitHubInstallationSummary {
  type: 'github_app_installation'
  version: 1
}

export interface GitHubInstallationRepositoryScope {
  repositoryId?: string
  repository?: string
}
