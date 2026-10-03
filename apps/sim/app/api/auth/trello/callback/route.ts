import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { trelloCallbackContract } from '@/lib/api/contracts/oauth-connections'
import { parseRequest } from '@/lib/api/server'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { isSameOrigin } from '@/lib/core/utils/validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'

const logger = createLogger('TrelloCallback')

export const dynamic = 'force-dynamic'

const TRELLO_STATE_COOKIE = 'trello_oauth_state'
const TRELLO_RETURN_URL_COOKIE = 'trello_return_url'
const TRELLO_COOKIE_PATH = '/api/auth/trello'

function escapeForJsString(value: string): string {
  return value.replace(/[\\'"<>&\r\n\u2028\u2029]/g, (ch) => {
    return `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
  })
}

function withResultParam(returnUrl: string, key: string, value: string): string {
  const url = new URL(returnUrl)
  url.searchParams.set(key, value)
  return url.toString()
}

function renderErrorPage(redirectUrl: string) {
  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Trello connection failed</title></head><body><script>window.location.href=${JSON.stringify(redirectUrl).replace(/</g, '\\u003c')};</script><p>Trello connection failed. Redirecting...</p></body></html>`,
    {
      status: 400,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  )
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const parsed = await parseRequest(trelloCallbackContract, request, {})
  if (!parsed.success) return parsed.response

  const baseUrl = getBaseUrl()
  const requestedReturnUrl = request.cookies.get(TRELLO_RETURN_URL_COOKIE)?.value
  const returnUrl =
    requestedReturnUrl && isSameOrigin(requestedReturnUrl)
      ? requestedReturnUrl
      : `${baseUrl}${APP_ENTRY_PATH}`
  const queryState = parsed.data.query.state
  const cookieState = request.cookies.get(TRELLO_STATE_COOKIE)?.value

  if (!queryState || !cookieState || queryState !== cookieState) {
    logger.warn('Trello callback rejected: state mismatch or missing state', {
      hasQueryState: Boolean(queryState),
      hasCookieState: Boolean(cookieState),
    })
    const response = renderErrorPage(withResultParam(returnUrl, 'error', 'trello_state_mismatch'))
    response.cookies.delete({ name: TRELLO_STATE_COOKIE, path: TRELLO_COOKIE_PATH })
    response.cookies.delete({ name: TRELLO_RETURN_URL_COOKIE, path: TRELLO_COOKIE_PATH })
    return response
  }

  const safeState = escapeForJsString(queryState)
  const successReturnUrl = escapeForJsString(withResultParam(returnUrl, 'trello_connected', 'true'))
  const storeFailureReturnUrl = escapeForJsString(
    withResultParam(returnUrl, 'error', 'trello_failed')
  )
  const authFailureReturnUrl = escapeForJsString(
    withResultParam(returnUrl, 'error', 'trello_auth_failed')
  )

  return new NextResponse(
    `<!DOCTYPE html>
<html>
  <head>
    <title>Connecting to Trello...</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        margin: 0;
        background: linear-gradient(135deg, #0052CC 0%, #0079BF 100%);
      }
      .container {
        background: white;
        padding: 2rem;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        text-align: center;
        max-width: 400px;
      }
      .spinner {
        border: 4px solid #f3f3f3;
        border-top: 4px solid #0052CC;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        animation: spin 1s linear infinite;
        margin: 0 auto 1rem;
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      .error {
        color: #ef4444;
        margin-top: 1rem;
      }
      h2 {
        color: #111827;
        margin: 0 0 0.5rem 0;
      }
      p {
        color: #6b7280;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="spinner"></div>
      <h2>Connecting to Trello</h2>
      <p id="status">Processing authorization...</p>
      <p id="error" class="error" style="display:none;"></p>
    </div>

    <script>
      (function() {
        const statusEl = document.getElementById('status');
        const errorEl = document.getElementById('error');

        try {
          const fragment = window.location.hash.substring(1);
          const params = new URLSearchParams(fragment);
          const token = params.get('token');
          const authError = params.get('error');

          if (authError) {
            throw new Error(authError);
          }

          if (!token) {
            throw new Error('No token received from Trello');
          }

          statusEl.textContent = 'Saving your connection...';

          fetch('${baseUrl}/api/auth/trello/store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ token: token, state: '${safeState}' })
          })
          .then(response => response.json())
          .then(data => {
            if (data.success) {
              statusEl.textContent = 'Success! Redirecting...';
              setTimeout(function() {
                window.location.href = '${successReturnUrl}';
              }, 500);
            } else {
              throw new Error(data.error || 'Failed to save connection');
            }
          })
          .catch(error => {
            errorEl.textContent = error.message || 'Failed to save connection';
            errorEl.style.display = 'block';
            statusEl.textContent = 'Connection failed';
            setTimeout(function() {
              window.location.href = '${storeFailureReturnUrl}';
            }, 3000);
          });

        } catch (error) {
          errorEl.textContent = error.message || 'Authorization failed';
          errorEl.style.display = 'block';
          statusEl.textContent = 'Connection failed';
          setTimeout(function() {
            window.location.href = '${authFailureReturnUrl}';
          }, 3000);
        }
      })();
    </script>
  </body>
</html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  )
})
