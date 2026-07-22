export const existingAuthorizationProofs = [
  { kind: 'access', caseId: 'workspace-permission-group-secrets-denied' },
  { kind: 'access', caseId: 'workspace-permission-group-apikeys-denied' },
  { kind: 'mutation', caseId: 'workspace-secrets-workspaceReadMember' },
  { kind: 'mutation', caseId: 'workspace-secrets-workspaceWriteMember' },
  { kind: 'mutation', caseId: 'workspace-secrets-workspaceAdminMember' },
  { kind: 'mutation', caseId: 'workspace-api-keys-workspaceReadMember' },
  { kind: 'mutation', caseId: 'workspace-api-keys-workspaceWriteMember' },
  { kind: 'mutation', caseId: 'workspace-api-keys-workspaceAdminMember' },
] as const
