import {
  CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE,
  getClientCredentialAccountDescriptor,
  partitionClientCredentialFields,
} from '@/lib/credentials/client-credential-accounts/descriptors'

/**
 * Shape of the decrypted secret blob persisted for client-credential accounts.
 * `providerId` is stored inside the blob so a mismatched credential row fails
 * loudly at resolution time instead of minting against another provider.
 */
export interface ClientCredentialAccountSecretBlob {
  type: typeof CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE
  providerId: string
  clientId: string
  certificateId?: string
  /** Absent on key-based credentials, which carry a {@link privateKey} instead. */
  clientSecret?: string
  orgId: string
  /** Optional region selector; absent on every credential created before it existed. */
  dataCenter?: string
  /** Provider permissions selected when connecting the application. */
  scope?: string
  /** Absent on every credential created before multi-grant support existed. */
  authMethod?: string
  privateKey?: string
  username?: string
  metadata?: Record<string, string>
}

export function parseClientCredentialAccountSecretBlob(
  decrypted: string,
  expectedProviderId: string
): ClientCredentialAccountSecretBlob {
  const malformed = new Error('Stored client-credential service-account secret is malformed')
  let parsed: ClientCredentialAccountSecretBlob
  try {
    parsed = JSON.parse(decrypted) as ClientCredentialAccountSecretBlob
  } catch {
    throw malformed
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw malformed
  }
  const descriptor = getClientCredentialAccountDescriptor(expectedProviderId)
  if (
    parsed.type !== CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE ||
    parsed.providerId !== expectedProviderId ||
    !descriptor
  ) {
    throw malformed
  }
  const { required } = partitionClientCredentialFields(descriptor, parsed.authMethod)
  if (
    required.some((field) => {
      const value = parsed[field.id]
      return typeof value !== 'string' || !value.trim()
    })
  ) {
    throw malformed
  }
  return parsed
}
