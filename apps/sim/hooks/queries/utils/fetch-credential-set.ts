import { requestJson } from '@/lib/api/client/request'
import { type CredentialSet, getCredentialSetContract } from '@/lib/api/contracts'

/**
 * Fetches a credential set by id (returns `null` for an empty id).
 *
 * Lives in this standalone (non-`'use client'`) module so server-reachable
 * workflow-comparison helpers can import it without pulling client-reference
 * stubs from the `'use client'` `@/hooks/queries/credential-sets` module.
 */
export async function fetchCredentialSetById(
  id: string,
  signal?: AbortSignal
): Promise<CredentialSet | null> {
  if (!id) return null
  const data = await requestJson(getCredentialSetContract, {
    params: { id },
    signal,
  })
  return data.credentialSet ?? null
}
