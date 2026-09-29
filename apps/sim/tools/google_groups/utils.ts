/**
 * Per-tool scope policies. Service-account tokens are minted with a tool's
 * `requiredScopes` (falling back to every scope the service requests), and a
 * domain-wide delegation grant rejects the whole token when any requested scope
 * is missing from the admin's allowlist. Pinning each tool to the API it calls
 * keeps the directory tools working for deployments that have not allowlisted
 * the Groups Settings scope.
 */
export const GOOGLE_GROUPS_DIRECTORY_SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.group',
  'https://www.googleapis.com/auth/admin.directory.group.member',
]

export const GOOGLE_GROUPS_SETTINGS_SCOPES = [
  'https://www.googleapis.com/auth/apps.groups.settings',
]
