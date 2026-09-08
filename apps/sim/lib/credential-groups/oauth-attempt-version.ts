/** An attempt from another release cannot establish the identity and configuration bindings required now. */
export class CredentialGroupOAuthStateVersionError extends Error {
  constructor() {
    super('Authorization was started before an update. Reopen your invitation and connect again.')
    this.name = 'CredentialGroupOAuthStateVersionError'
  }
}

/** Rejects a different state protocol before decrypting any authorization material. */
export function assertCredentialGroupOAuthAttemptVersion(value: unknown, expected: number): void {
  if (
    value !== null &&
    typeof value === 'object' &&
    'version' in value &&
    typeof value.version === 'number' &&
    value.version !== expected
  ) {
    throw new CredentialGroupOAuthStateVersionError()
  }
}
