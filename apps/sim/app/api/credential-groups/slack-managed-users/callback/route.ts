import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { slackCredentialGroupConfigurationCallbackContract } from '@/lib/api/contracts/credential-groups'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { completeSlackCredentialGroupConfiguration } from '@/lib/credential-groups/application/slack-managed-users'
import { SlackManagedUsersError } from '@/lib/credential-groups/slack-managed-users'

const logger = createLogger('SlackCredentialGroupConfigurationCallbackAPI')
const CHANNEL_NAME = 'slack-managed-users'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function jsonLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}

function closePopup(params: {
  ok: boolean
  message: string
  state?: string
  credentialGroupId?: string
  slackBotCredentialId?: string
  reason: string
}): NextResponse {
  const title = params.ok ? 'Slack configured' : 'Slack setup failed'
  const payload = {
    type: CHANNEL_NAME,
    ok: params.ok,
    state: params.state,
    credentialGroupId: params.credentialGroupId,
    slackBotCredentialId: params.slackBotCredentialId,
    reason: params.reason,
  }
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><p>${escapeHtml(params.message)}</p><script>
    try { var channel = new BroadcastChannel(${jsonLiteral(CHANNEL_NAME)}); channel.postMessage(${jsonLiteral(payload)}); channel.close() } catch (error) {}
    setTimeout(function () { window.close() }, 500)
  </script></body></html>`
  return new NextResponse(body, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'text/html; charset=utf-8',
    },
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
      reason: 'unauthenticated',
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
