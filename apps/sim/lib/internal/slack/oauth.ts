import { Buffer } from 'node:buffer'
import { z } from 'zod'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { requestSlackApi } from '@/lib/internal/slack/client'
import { SLACK_SEARCH_SCOPES } from '@/lib/slack-search/constants'

const botGrantSchema = z.object({
  ok: z.literal(true),
  app_id: z.string().min(1),
  token_type: z.literal('bot'),
  access_token: z.string().min(1),
  bot_user_id: z.string().min(1),
  scope: z.string(),
  team: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  is_enterprise_install: z.boolean().optional(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
})

/** Exchanges a single-use code for a workspace bot grant; user grants are never accepted. */
export async function exchangeSlackBotAuthorization(input: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
}) {
  const response = await secureFetchWithValidation('https://slack.com/api/oauth.v2.access', {
    profile: 'configuredEndpoint',
    redirectPolicy: { mode: 'standard', sendCredentialsOnCrossOriginRedirect: false },
    maxResponseBytes: 64 * 1024,
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ code: input.code, redirect_uri: input.redirectUri }).toString(),
    signal: AbortSignal.timeout(10_000),
  })
  const value = await readResponseJsonWithLimit<unknown>(response, {
    maxBytes: 64 * 1024,
    label: 'Slack OAuth response',
  })
  const parsed = botGrantSchema.safeParse(value)
  if (!response.ok || !parsed.success) {
    throw new OrchestrationError(
      'validation',
      'Slack authorization failed. Check the client credentials and install the app again.'
    )
  }
  return parsed.data
}

/** Runs after exchange so the application can clean up an issued grant if policy rejects it. */
export function validateSlackBotAuthorization(
  grant: z.infer<typeof botGrantSchema>,
  requiredScopes: readonly string[] = SLACK_SEARCH_SCOPES
) {
  if (grant.is_enterprise_install || grant.refresh_token || grant.expires_in)
    throw new OrchestrationError(
      'validation',
      'Install the app in one workspace with token rotation disabled.'
    )
  const scopes = grant.scope.split(',').map((scope) => scope.trim())
  const missing = requiredScopes.filter((scope) => !scopes.includes(scope))
  if (missing.length)
    throw new OrchestrationError(
      'validation',
      `Reinstall the app with these scopes: ${missing.join(', ')}`
    )
}

/** Revokes an unused bot grant after failed setup without logging provider credentials. */
export async function revokeSlackBotAuthorization(accessToken: string) {
  const response = await requestSlackApi({
    accessToken,
    method: 'auth.revoke',
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status !== 200 || response.data.ok !== true || response.data.revoked !== true)
    throw new OrchestrationError('validation', 'Slack could not revoke the unused setup token')
}
