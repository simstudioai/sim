import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { quickBooksCallbackContract } from '@/lib/api/contracts/oauth-connections'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { isSameOrigin } from '@/lib/core/utils/validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { completeQuickBooksConnection } from '@/lib/credentials/application/complete-quickbooks-connection'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { normalizeQuickBooksRealmId } from '@/lib/oauth/quickbooks'
import { parseQuickBooksOAuthState } from '@/lib/oauth/quickbooks-state'

const logger = createLogger('QuickBooksCallback')

export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(async (request: NextRequest) => {
  const baseUrl = getBaseUrl()
  const fallbackUrl = `${baseUrl}${APP_ENTRY_PATH}`
  let validatedReturnUrl: URL | null = null

  try {
    const session = await getSession()
    if (!session?.user?.id || !session.session?.id) {
      return NextResponse.redirect(`${fallbackUrl}?error=unauthorized`)
    }
    const parsed = await parseRequest(quickBooksCallbackContract, request, {})
    if (!parsed.success) return parsed.response

    const state = parseQuickBooksOAuthState({
      state: parsed.data.query.state,
      userId: session.user.id,
    })
    if (!isSameOrigin(state.returnUrl)) {
      throw new Error('QuickBooks OAuth state contains an invalid return URL')
    }
    validatedReturnUrl = new URL(state.returnUrl)
    if (parsed.data.query.error) {
      logger.warn('QuickBooks OAuth authorization was not completed', {
        error: parsed.data.query.error,
        hasDescription: Boolean(parsed.data.query.error_description),
      })
      validatedReturnUrl.searchParams.set('error', 'quickbooks_access_denied')
      return NextResponse.redirect(validatedReturnUrl)
    }
    if (!parsed.data.query.code || !parsed.data.query.realmId) {
      throw new Error('QuickBooks callback is missing its authorization code or company identity')
    }

    await completeQuickBooksConnection.execute({
      principal: {
        kind: 'session',
        userId: session.user.id,
        sessionId: session.session.id,
      },
      input: {
        draftId: state.draftId,
        code: parsed.data.query.code,
        realmId: normalizeQuickBooksRealmId(parsed.data.query.realmId),
        redirectUri: `${baseUrl}/api/auth/oauth2/callback/quickbooks`,
        signal: request.signal,
      },
      request,
    })

    validatedReturnUrl.searchParams.set('quickbooks_connected', 'true')
    return NextResponse.redirect(validatedReturnUrl)
  } catch (error) {
    logger.error('QuickBooks OAuth callback failed', { error })
    const errorUrl = validatedReturnUrl ?? new URL(fallbackUrl)
    errorUrl.searchParams.set('error', 'quickbooks_callback_error')
    return NextResponse.redirect(errorUrl)
  }
})
