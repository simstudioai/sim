import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import {
  type CredentialGroupApiKeyVerification,
  CredentialGroupApiKeyVerificationError,
  type CredentialGroupApiKeyVerifier,
} from '@/lib/credential-groups/api-key-providers/types'

const FIREFLIES_GRAPHQL_URL = 'https://api.fireflies.ai/graphql'

/** Resolves the key's own owner: `user(id:)` defaults to the caller when no id is given. */
const VIEWER_QUERY = `query User { user { user_id name email } }`

interface FirefliesViewerResponse {
  data?: { user?: { user_id?: string; name?: string; email?: string } | null }
  errors?: Array<{ message?: string }>
}

export const firefliesApiKeyVerifier: CredentialGroupApiKeyVerifier = {
  provider: 'fireflies',
  async verify(fields: Record<string, string>): Promise<CredentialGroupApiKeyVerification> {
    const apiKey = fields.apiKey
    let response: Response
    try {
      response = await fetch(FIREFLIES_GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query: VIEWER_QUERY }),
      })
    } catch {
      throw new CredentialGroupApiKeyVerificationError(
        'Could not reach Fireflies to check this key. Please try again.'
      )
    }

    if (response.status === 401 || response.status === 403) {
      throw new CredentialGroupApiKeyVerificationError('Fireflies rejected this API key.')
    }
    if (!response.ok) {
      throw new CredentialGroupApiKeyVerificationError(
        'Fireflies could not verify this key right now. Please try again.'
      )
    }

    const payload = (await response.json().catch(() => null)) as FirefliesViewerResponse | null
    if (payload?.errors?.length) {
      throw new CredentialGroupApiKeyVerificationError('Fireflies rejected this API key.')
    }

    const user = payload?.data?.user
    const email = user?.email ? normalizeEmail(user.email) : undefined
    if (!user?.user_id || !email || !isValidEmailSyntax(email)) {
      throw new CredentialGroupApiKeyVerificationError(
        'Fireflies did not identify the owner of this key.'
      )
    }

    return {
      identity: 'verified',
      subjectId: user.user_id,
      displayName: user.name?.trim() || email,
      email,
    }
  },
}
