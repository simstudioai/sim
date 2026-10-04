/** Negotiates against the selected worker; redirects cannot establish another peer's support. */
export async function supportsFileOwnerProtocol(baseURL: string): Promise<boolean> {
  try {
    // boundary-raw-fetch: the selected worker advertises its live file-owner protocol in health headers.
    const response = await fetch(`${baseURL.replace(/\/$/, '')}/healthz`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(2_000),
    })
    return response.ok && response.headers.get('X-Mothership-File-Owner-Protocol') === '1'
  } catch {
    return false
  }
}
