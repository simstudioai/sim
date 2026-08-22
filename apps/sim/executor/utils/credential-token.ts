import { createLogger } from '@sim/logger'
import { generateInternalToken } from '@/lib/auth/internal'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('ExecutorCredentialToken')

/**
 * Fetches a credential's access token from the app rather than resolving it here.
 *
 * Refreshing an OAuth token needs the provider's client id and secret, read through
 * `requireOAuthClientCapability`, which THROWS when they are absent. Only the app
 * container loads those (from `SIM_ENV_SECRET_ID`); workflow execution runs in a
 * Trigger.dev worker whose environment does not carry them. Resolving in-process there
 * turns every credential whose access token has expired into a refresh failure, and a
 * still-valid token hides it until the token lapses.
 *
 * See `.claude/rules/sim-architecture.md`, "The app/worker runtime boundary".
 *
 * The route authorizes the credential itself, so this never widens access.
 */
export async function fetchCredentialAccessToken(params: {
  requestId: string
  credentialId: string
  userId: string
  workflowId?: string
}): Promise<string> {
  const { requestId, credentialId, userId, workflowId } = params

  const url = new URL('/api/auth/oauth/token', getInternalApiBaseUrl())
  if (workflowId) url.searchParams.set('workflowId', workflowId)

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    headers.Authorization = `Bearer ${await generateInternalToken(userId)}`
  } catch (_e) {
    // Swallow mint errors; the request then fails authentication and reports upstream.
  }

  // boundary-raw-fetch: same-origin token route, authenticated by the internal JWT minted above
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ credentialId, ...(workflowId ? { workflowId } : {}) }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Credential token request failed`, {
      status: response.status,
      credentialId,
    })
    let message = errorText
    try {
      const parsed = JSON.parse(errorText)
      if (parsed.error) message = parsed.error
    } catch {
      // Use raw text
    }
    throw new Error(message)
  }

  const { accessToken } = (await response.json()) as { accessToken?: string }
  if (!accessToken) {
    throw new Error('Credential token response carried no access token')
  }
  return accessToken
}
