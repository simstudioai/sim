import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { slackCredentialGroupConfigurationCallbackContract } from '@/lib/api/contracts/credential-groups'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { completeSlackCredentialGroupConfiguration } from '@/lib/credential-groups/application/slack-managed-users'
import { SlackManagedUsersError } from '@/lib/credential-groups/slack-managed-users'

const logger = createLogger('SlackCredentialGroupConfigurationCallbackAPI')
function closePopup(params: {
  ok: boolean
  message: string
  state?: string
  credentialGroupId?: string
  slackBotCredentialId?: string
  reason: string
}): NextResponse {
  const url = new URL('/credential-groups/slack-complete', getBaseUrl())
  url.searchParams.set('mode', 'managed')
  url.searchParams.set('ok', String(params.ok))
  for (const key of ['state', 'credentialGroupId', 'slackBotCredentialId', 'reason'] as const) {
    const value = params[key]
    if (value) url.searchParams.set(key, value)
  }
  return NextResponse.redirect(url, {
    status: 303,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const rawState = new URL(request.url).searchParams.get('state')?.slice(0, 512)
  const session = await getSession()
  if (!session?.user?.id || !session.session?.id) {
    return closePopup({
      ok: false,
      message: 'Sign in to Sim to complete this Slack setup.',
      state: rawState,
      reason: 'signin_required',
    })
  }
  const parsed = await parseRequest(slackCredentialGroupConfigurationCallbackContract, request, {})
  if (!parsed.success) {
    return closePopup({
      ok: false,
      message: 'Slack returned an invalid authorization response.',
      state: rawState,
      reason: 'invalid_callback',
    })
  }
  const { state, code, error: providerError } = parsed.data.query
  try {
    const result = await completeSlackCredentialGroupConfiguration.execute({
      principal: {
        kind: 'session',
        userId: session.user.id,
        sessionId: session.session.id,
      },
      input: { state, code, providerError },
      request,
    })
    return result.ok
      ? closePopup({
          ok: true,
          message: 'Slack is ready for this Credential Group. You can close this window.',
          state,
          credentialGroupId: result.result.credentialGroupId,
          slackBotCredentialId: result.result.slackBotCredentialId,
          reason: result.reason,
        })
      : closePopup({
          ok: false,
          message: 'Slack authorization was cancelled.',
          state,
          reason: result.reason,
        })
  } catch (error) {
    const orchestrationError = asOrchestrationError(error)
    const message =
      error instanceof SlackManagedUsersError || orchestrationError
        ? getErrorMessage(error)
        : 'Slack setup failed. Please try again.'
    logger.error('Slack Credential Group configuration callback failed', {
      error: getErrorMessage(error),
    })
    return closePopup({
      ok: false,
      message,
      state,
      reason:
        error instanceof SlackManagedUsersError
          ? error.code
          : (orchestrationError?.code ?? 'unknown'),
    })
  }
})
