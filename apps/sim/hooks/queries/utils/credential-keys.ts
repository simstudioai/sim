/**
 * React Query key factory for workspace credentials.
 *
 * Lives in this standalone (non-`'use client'`) module — like
 * {@link file://./folder-keys.ts} — so server-evaluated code (block
 * definitions, server prefetch) can import it without pulling client-reference
 * stubs from the `'use client'` `@/hooks/queries/credentials` module.
 */
export const workspaceCredentialKeys = {
  all: ['workspaceCredentials'] as const,
  lists: () => [...workspaceCredentialKeys.all, 'list'] as const,
  list: (workspaceId?: string, type?: string, providerId?: string) =>
    [
      ...workspaceCredentialKeys.lists(),
      workspaceId ?? 'none',
      type ?? 'all',
      providerId ?? 'all',
    ] as const,
  details: () => [...workspaceCredentialKeys.all, 'detail'] as const,
  detail: (credentialId?: string) =>
    [...workspaceCredentialKeys.details(), credentialId ?? 'none'] as const,
  members: (credentialId?: string) =>
    [...workspaceCredentialKeys.detail(credentialId), 'members'] as const,
  /**
   * Keyed by name and scope rather than credential id: the usage trail is recorded against
   * the secret's name, so it survives a credential row being recreated for the same key.
   */
  usage: (workspaceId?: string, name?: string, scope?: string) =>
    [
      ...workspaceCredentialKeys.all,
      'usage',
      workspaceId ?? 'none',
      scope ?? 'all',
      name ?? '',
    ] as const,
  /**
   * Keyed by name alone — references are found by name, so neither the credential id nor a
   * scope narrows the result, and adding either would split one answer across cache entries.
   */
  references: (workspaceId?: string, name?: string) =>
    [...workspaceCredentialKeys.all, 'references', workspaceId ?? 'none', name ?? ''] as const,
}

export const organizationCredentialKeys = {
  all: ['organizationCredentials'] as const,
  lists: () => [...organizationCredentialKeys.all, 'list'] as const,
  list: (organizationId?: string, type?: string, providerId?: string) =>
    [
      ...organizationCredentialKeys.lists(),
      organizationId ?? 'none',
      type ?? 'all',
      providerId ?? 'all',
    ] as const,
}
