import type { WorkspaceCredential } from '@/lib/api/contracts'

/**
 * Returns the secret names the current credential-list actor may mount as plaintext.
 * The credentials API has already derived workspace-admin and per-credential roles;
 * this selector deliberately keeps only environment credentials with effective admin access.
 */
export function selectRawMountableSecretNames(credentials: WorkspaceCredential[]): string[] {
  const names = new Set<string>()

  for (const credential of credentials) {
    if (
      (credential.type === 'env_workspace' || credential.type === 'env_personal') &&
      credential.role === 'admin' &&
      credential.envKey
    ) {
      names.add(credential.envKey)
    }
  }

  return [...names].sort()
}
