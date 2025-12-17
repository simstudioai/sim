import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ServiceNowAuthorize')

export const dynamic = 'force-dynamic'

/**
 * ServiceNow OAuth scopes
 * useraccount - Default scope for user account access
 * Note: ServiceNow always returns 'useraccount' in OAuth responses regardless of requested scopes.
 * Table API permissions are configured at the OAuth application level in ServiceNow.
 */
const SERVICENOW_SCOPES = 'useraccount'

/**
 * Validates a ServiceNow instance URL format
 */
function isValidInstanceUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname.endsWith('.service-now.com') || parsed.hostname.endsWith('.servicenow.com'))
    )
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const instanceUrl = request.nextUrl.searchParams.get('instanceUrl')
    const clientId = request.nextUrl.searchParams.get('clientId')
    const clientSecret = request.nextUrl.searchParams.get('clientSecret')
    const returnUrl = request.nextUrl.searchParams.get('returnUrl')

    // If any required parameter is missing, show the form
    if (!instanceUrl || !clientId || !clientSecret) {
      const returnUrlParam = returnUrl ? encodeURIComponent(returnUrl) : ''
      return new NextResponse(
        `<!DOCTYPE html>
<html>
  <head>
    <title>Connect ServiceNow Instance</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
        background: linear-gradient(135deg, #81B5A1 0%, #5A8A75 100%);
        padding: 20px;
        box-sizing: border-box;
      }
      .container {
        background: white;
        padding: 2rem;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        text-align: center;
        max-width: 450px;
        width: 100%;
      }
      h2 {
        color: #111827;
        margin: 0 0 0.5rem 0;
      }
      p {
        color: #6b7280;
        margin: 0 0 1.5rem 0;
      }
      .form-group {
        text-align: left;
        margin-bottom: 1rem;
      }
      label {
        display: block;
        font-size: 0.875rem;
        font-weight: 500;
        color: #374151;
        margin-bottom: 0.25rem;
      }
      input {
        width: 100%;
        padding: 0.75rem;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-size: 1rem;
        box-sizing: border-box;
      }
      input:focus {
        outline: none;
        border-color: #81B5A1;
        box-shadow: 0 0 0 3px rgba(129, 181, 161, 0.2);
      }
      button {
        width: 100%;
        padding: 0.75rem;
        background: #81B5A1;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        cursor: pointer;
        font-weight: 500;
        margin-top: 0.5rem;
      }
      button:hover {
        background: #6A9A87;
      }
      .help {
        font-size: 0.75rem;
        color: #9ca3af;
        margin-top: 0.25rem;
      }
      .error {
        color: #dc2626;
        font-size: 0.875rem;
        margin-bottom: 1rem;
        display: none;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h2>Connect Your ServiceNow Instance</h2>
      <p>Enter your ServiceNow credentials to continue</p>
      <div id="error" class="error"></div>
      <form onsubmit="handleSubmit(event)">
        <div class="form-group">
          <label for="instanceUrl">Instance URL</label>
          <input
            type="text"
            id="instanceUrl"
            placeholder="https://mycompany.service-now.com"
            required
          />
          <p class="help">Your ServiceNow instance URL (e.g., https://yourcompany.service-now.com)</p>
        </div>
        <div class="form-group">
          <label for="clientId">Client ID</label>
          <input
            type="text"
            id="clientId"
            placeholder="Enter your OAuth Client ID"
            required
          />
          <p class="help">OAuth Client ID from your ServiceNow Application Registry</p>
        </div>
        <div class="form-group">
          <label for="clientSecret">Client Secret</label>
          <input
            type="password"
            id="clientSecret"
            placeholder="Enter your OAuth Client Secret"
            required
          />
          <p class="help">OAuth Client Secret from your ServiceNow Application Registry</p>
        </div>
        <button type="submit">Connect Instance</button>
      </form>
    </div>

    <script>
      const returnUrl = '${returnUrlParam}';
      function handleSubmit(e) {
        e.preventDefault();
        const errorEl = document.getElementById('error');
        let instanceUrl = document.getElementById('instanceUrl').value.trim();
        const clientId = document.getElementById('clientId').value.trim();
        const clientSecret = document.getElementById('clientSecret').value.trim();

        // Ensure https:// prefix
        if (!instanceUrl.startsWith('https://') && !instanceUrl.startsWith('http://')) {
          instanceUrl = 'https://' + instanceUrl;
        }
        
        // Validate the URL format
        try {
          const parsed = new URL(instanceUrl);
          if (!parsed.hostname.endsWith('.service-now.com') && !parsed.hostname.endsWith('.servicenow.com')) {
            errorEl.textContent = 'Please enter a valid ServiceNow instance URL (e.g., https://yourcompany.service-now.com)';
            errorEl.style.display = 'block';
            return;
          }
          // Clean the URL (remove trailing slashes, paths)
          instanceUrl = parsed.origin;
        } catch {
          errorEl.textContent = 'Please enter a valid URL';
          errorEl.style.display = 'block';
          return;
        }

        if (!clientId) {
          errorEl.textContent = 'Please enter your Client ID';
          errorEl.style.display = 'block';
          return;
        }

        if (!clientSecret) {
          errorEl.textContent = 'Please enter your Client Secret';
          errorEl.style.display = 'block';
          return;
        }

        let url = window.location.pathname + '?instanceUrl=' + encodeURIComponent(instanceUrl);
        url += '&clientId=' + encodeURIComponent(clientId);
        url += '&clientSecret=' + encodeURIComponent(clientSecret);
        if (returnUrl) {
          url += '&returnUrl=' + returnUrl;
        }
        window.location.href = url;
      }
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
    }

    // Validate instance URL
    if (!isValidInstanceUrl(instanceUrl)) {
      logger.error('Invalid ServiceNow instance URL:', { instanceUrl })
      return NextResponse.json(
        {
          error:
            'Invalid ServiceNow instance URL. Must be a valid .service-now.com or .servicenow.com domain.',
        },
        { status: 400 }
      )
    }

    // Clean the instance URL
    const parsedUrl = new URL(instanceUrl)
    const cleanInstanceUrl = parsedUrl.origin

    const baseUrl = getBaseUrl()
    const redirectUri = `${baseUrl}/api/auth/oauth2/callback/servicenow`

    const state = crypto.randomUUID()

    // ServiceNow OAuth authorization URL
    const oauthUrl =
      `${cleanInstanceUrl}/oauth_auth.do?` +
      new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        state: state,
        scope: SERVICENOW_SCOPES,
      }).toString()

    logger.info('Initiating ServiceNow OAuth:', {
      instanceUrl: cleanInstanceUrl,
      requestedScopes: SERVICENOW_SCOPES,
      redirectUri,
      returnUrl: returnUrl || 'not specified',
    })

    const response = NextResponse.redirect(oauthUrl)

    // Store state, instance URL, and credentials in cookies for validation in callback
    response.cookies.set('servicenow_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10, // 10 minutes
      path: '/',
    })

    response.cookies.set('servicenow_instance_url', cleanInstanceUrl, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10,
      path: '/',
    })

    // Store client credentials in cookies for the callback to use
    response.cookies.set('servicenow_client_id', clientId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10,
      path: '/',
    })

    response.cookies.set('servicenow_client_secret', clientSecret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10,
      path: '/',
    })

    if (returnUrl) {
      response.cookies.set('servicenow_return_url', returnUrl, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 10,
        path: '/',
      })
    }

    return response
  } catch (error) {
    logger.error('Error initiating ServiceNow authorization:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
