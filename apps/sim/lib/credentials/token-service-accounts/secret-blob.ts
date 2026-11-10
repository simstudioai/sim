import { TOKEN_SERVICE_ACCOUNT_SECRET_TYPE } from '@/lib/credentials/token-service-accounts/descriptors'

/**
 * Shape of the decrypted secret blob persisted for token service accounts.
 * `providerId` is stored inside the blob so a mismatched credential row fails
 * loudly at resolution time instead of returning another provider's token.
 */
export interface TokenServiceAccountSecretBlob {
  type: typeof TOKEN_SERVICE_ACCOUNT_SECRET_TYPE
  providerId: string
  apiToken: string
  domain?: string
  providerWorkspaceId?: string
  metadata?: Record<string, string>
}

export function parseTokenServiceAccountSecretBlob(
  decrypted: string,
  expectedProviderId: string
): TokenServiceAccountSecretBlob {
  const parsed = JSON.parse(decrypted) as TokenServiceAccountSecretBlob
  if (
    parsed.type !== TOKEN_SERVICE_ACCOUNT_SECRET_TYPE ||
    parsed.providerId !== expectedProviderId ||
    !parsed.apiToken
  ) {
    throw new Error('Stored token service-account secret is malformed')
  }
  return parsed
}
