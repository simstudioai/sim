import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import { resolveVantaClientToken } from '@/lib/credentials/client-credential-accounts/vanta-token'

/** Reuses the application-wide Vanta token for connection validation and execution. */
export async function mintVantaServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  const token = await resolveVantaClientToken(fields, { signal: options?.signal })
  return {
    ...token,
    ...(options?.skipIdentity
      ? {}
      : {
          identity: {
            displayName: 'Vanta application',
            principal: null,
            auditMetadata: { vantaClientId: fields.clientId },
            storedMetadata: { apiDomain: token.apiDomain },
          },
        }),
  }
}
