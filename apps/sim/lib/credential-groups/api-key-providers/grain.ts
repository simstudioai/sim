import {
  type CredentialGroupApiKeyVerification,
  CredentialGroupApiKeyVerificationError,
  type CredentialGroupApiKeyVerifier,
  unprovenApiKeySubjectId,
} from '@/lib/credential-groups/api-key-providers/types'

/**
 * Cheapest authenticated read in Grain's public API, used purely as a liveness probe.
 * Grain exposes no endpoint naming the key's owner, so identity stays `unproven`.
 */
const GRAIN_TEAMS_URL = 'https://api.grain.com/_/public-api/v2/teams'

export const grainApiKeyVerifier: CredentialGroupApiKeyVerifier = {
  provider: 'grain',
  async verify(fields: Record<string, string>): Promise<CredentialGroupApiKeyVerification> {
    const apiKey = fields.apiKey
    let response: Response
    try {
      response = await fetch(GRAIN_TEAMS_URL, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      })
    } catch {
      throw new CredentialGroupApiKeyVerificationError(
        'Could not reach Grain to check this key. Please try again.'
      )
    }

    if (response.status === 401 || response.status === 403) {
      throw new CredentialGroupApiKeyVerificationError('Grain rejected this API key.')
    }
    if (!response.ok) {
      throw new CredentialGroupApiKeyVerificationError(
        'Grain could not verify this key right now. Please try again.'
      )
    }

    return {
      identity: 'unproven',
      subjectId: unprovenApiKeySubjectId(fields),
      displayName: 'Grain account',
    }
  },
}
