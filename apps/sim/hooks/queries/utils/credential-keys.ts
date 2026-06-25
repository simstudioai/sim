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
}
