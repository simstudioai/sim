import {
  type CredentialGroupApiKeyVerification,
  CredentialGroupApiKeyVerificationError,
  type CredentialGroupApiKeyVerifier,
  unprovenApiKeySubjectId,
} from '@/lib/credential-groups/api-key-providers/types'

/**
 * Smallest authenticated read in Granola's public API, used purely as a liveness probe.
 * Granola exposes no endpoint naming the key's owner, so identity stays `unproven`.
 *
 * The base URL is repeated rather than imported from `@/tools/granola/utils`: nothing under
 * `lib/` may depend on the tool registry, which the realtime prune graph enforces.
 */
const GRANOLA_PROBE_URL = 'https://public-api.granola.ai/v1/folders?page_size=1'

export const granolaApiKeyVerifier: CredentialGroupApiKeyVerifier = {
  provider: 'granola',
  async verify(fields: Record<string, string>): Promise<CredentialGroupApiKeyVerification> {
    const apiKey = fields.apiKey
    let response: Response
    try {
      response = await fetch(GRANOLA_PROBE_URL, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      })
    } catch {
      throw new CredentialGroupApiKeyVerificationError(
        'Could not reach Granola to check this key. Please try again.'
      )
    }

    if (response.status === 401 || response.status === 403) {
      throw new CredentialGroupApiKeyVerificationError('Granola rejected this API key.')
    }
    if (!response.ok) {
      throw new CredentialGroupApiKeyVerificationError(
        'Granola could not verify this key right now. Please try again.'
      )
    }

    return {
      identity: 'unproven',
      subjectId: unprovenApiKeySubjectId(fields),
      displayName: 'Granola account',
    }
  },
}
