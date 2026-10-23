import type { VantaCredentialParams } from '@/tools/vanta/types'

/** Restricts provider requests to the API deployment saved on the credential. */
export function getVantaBaseUrl(apiDomain: string): string {
  if (apiDomain !== 'https://api.vanta.com' && apiDomain !== 'https://api.vanta-gov.com') {
    throw new Error('Invalid Vanta API domain')
  }
  return apiDomain
}

/** Expires a rejected saved-account token so the next authorized call can renew it. */
export async function fetchVantaWithAuth(
  params: VantaCredentialParams,
  doFetch: (accessToken: string) => Promise<Response>,
  options: { signal?: AbortSignal } = {}
): Promise<Response> {
  options.signal?.throwIfAborted()
  const response = await doFetch(params.accessToken)
  options.signal?.throwIfAborted()
  if (response.status === 401) {
    const { invalidateVantaClientToken } = await import(
      '@/lib/credentials/client-credential-accounts/vanta-token'
    )
    try {
      await invalidateVantaClientToken(params.accessToken, params.apiDomain)
    } catch (error) {
      await response.body?.cancel()
      throw error
    }
  }
  return response
}
