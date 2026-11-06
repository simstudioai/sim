export const oauthCredentialKeys = {
  all: ['oauthCredentials'] as const,
  lists: () => [...oauthCredentialKeys.all, 'list'] as const,
  list: (
    providerId?: string,
    workspaceId?: string,
    workflowId?: string,
    organizationId?: string,
    purpose?: 'browsing'
  ) =>
    [
      ...oauthCredentialKeys.lists(),
      providerId ?? 'none',
      workspaceId ?? 'none',
      workflowId ?? 'none',
      organizationId ?? 'none',
      purpose ?? 'indexing',
    ] as const,
  details: () => [...oauthCredentialKeys.all, 'detail'] as const,
  detail: (credentialId?: string, workflowId?: string) =>
    [...oauthCredentialKeys.details(), credentialId ?? 'none', workflowId ?? 'none'] as const,
}
