import { decryptSecret } from '@/lib/core/security/encryption'

interface OauthCredsDiffParams {
  incomingClientId: string | null | undefined
  incomingClientIdProvided: boolean
  incomingClientSecret: string | null | undefined
  incomingClientSecretProvided: boolean
  currentClientId: string | null | undefined
  currentEncryptedClientSecret: string | null | undefined
}

/**
 * Detect whether OAuth client credentials on an MCP server row have changed.
 * Decrypt failure (corrupted ciphertext, rotated key) is treated as a change so
 * admins can overwrite an unusable stored secret instead of getting a 500.
 */
export async function oauthCredsChanged(params: OauthCredsDiffParams): Promise<boolean> {
  const clientIdChanged =
    params.incomingClientIdProvided &&
    (params.incomingClientId || null) !== (params.currentClientId ?? null)

  let clientSecretChanged = false
  if (params.incomingClientSecretProvided) {
    if (!params.incomingClientSecret) {
      clientSecretChanged = params.currentEncryptedClientSecret != null
    } else if (!params.currentEncryptedClientSecret) {
      clientSecretChanged = true
    } else {
      try {
        const { decrypted } = await decryptSecret(params.currentEncryptedClientSecret)
        clientSecretChanged = decrypted !== params.incomingClientSecret
      } catch {
        clientSecretChanged = true
      }
    }
  }

  return clientIdChanged || clientSecretChanged
}
