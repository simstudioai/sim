interface SecretDetailCredential {
  workspaceId: string
  type: string
}

interface SecretDetailAccess {
  credential: SecretDetailCredential | null
  hasWorkspaceAccess: boolean
  hasActiveMembership: boolean
  isAdmin: boolean
}

export function canOpenSecretDetail(options: {
  workspaceId: string
  secretsHidden: boolean
  access: SecretDetailAccess
}): boolean {
  const { access } = options
  return Boolean(
    !options.secretsHidden &&
      access.credential &&
      access.credential.workspaceId === options.workspaceId &&
      (access.credential.type === 'env_personal' || access.credential.type === 'env_workspace') &&
      access.hasWorkspaceAccess &&
      (access.hasActiveMembership || access.isAdmin)
  )
}
