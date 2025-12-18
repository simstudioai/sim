import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SalesforceAuthorize')

export const dynamic = 'force-dynamic'

const SALESFORCE_SCOPES = ['api', 'refresh_token', 'openid', 'offline_access'].join(' ')

/**
 * Generates a PKCE code verifier and challenge
 */
async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  const verifier = Buffer.from(array).toString('base64url')

  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const challenge = Buffer.from(digest).toString('base64url')

  return { verifier, challenge }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const clientId = env.SALESFORCE_CLIENT_ID

    if (!clientId) {
      logger.error('SALESFORCE_CLIENT_ID not configured')
      return NextResponse.json({ error: 'Salesforce client ID not configured' }, { status: 500 })
    }

    const orgType = request.nextUrl.searchParams.get('orgType')
    const customDomain = request.nextUrl.searchParams.get('customDomain')
    const returnUrl = request.nextUrl.searchParams.get('returnUrl')

    if (!orgType) {
      const returnUrlParam = returnUrl ? encodeURIComponent(returnUrl) : ''
      return new NextResponse(
        `<!DOCTYPE html>
<html>
  <head>
    <title>Connect Salesforce</title>
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
        background: linear-gradient(135deg, #00A1E0 0%, #032D60 100%);
      }
      .container {
        background: white;
        padding: 2rem;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        text-align: center;
        max-width: 420px;
        width: 90%;
      }
      h2 {
        color: #111827;
        margin: 0 0 0.5rem 0;
      }
      p {
        color: #6b7280;
        margin: 0 0 1.5rem 0;
        font-size: 0.95rem;
      }
      .options {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin-bottom: 1.5rem;
      }
      .option {
        display: flex;
        align-items: center;
        padding: 1rem;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
        text-align: left;
      }
      .option:hover {
        border-color: #00A1E0;
        background: #f0f9ff;
      }
      .option.selected {
        border-color: #00A1E0;
        background: #e0f2fe;
      }
      .option input {
        margin-right: 12px;
        width: 18px;
        height: 18px;
        accent-color: #00A1E0;
      }
      .option-content {
        flex: 1;
      }
      .option-title {
        font-weight: 600;
        color: #111827;
        font-size: 0.95rem;
      }
      .option-desc {
        font-size: 0.8rem;
        color: #6b7280;
        margin-top: 2px;
      }
      .custom-domain {
        margin-top: 0.75rem;
        display: none;
      }
      .custom-domain.visible {
        display: block;
      }
      .custom-domain input {
        width: 100%;
        padding: 0.75rem;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-size: 1rem;
        box-sizing: border-box;
      }
      .custom-domain input:focus {
        outline: none;
        border-color: #00A1E0;
        box-shadow: 0 0 0 3px rgba(0, 161, 224, 0.2);
      }
      button {
        width: 100%;
        padding: 0.875rem;
        background: #00A1E0;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        cursor: pointer;
        font-weight: 600;
        transition: background 0.2s;
      }
      button:hover {
        background: #0082b3;
      }
      button:disabled {
        background: #9ca3af;
        cursor: not-allowed;
      }
      .help {
        font-size: 0.8rem;
        color: #9ca3af;
        margin-top: 1rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h2>Connect Your Salesforce Account</h2>
      <p>Select your Salesforce environment type</p>

      <form onsubmit="handleSubmit(event)">
        <div class="options">
          <label class="option" onclick="selectOption('production')">
            <input type="radio" name="orgType" value="production" id="production">
            <div class="option-content">
              <div class="option-title">Production</div>
              <div class="option-desc">Live Salesforce org with real data</div>
            </div>
          </label>

          <label class="option" onclick="selectOption('sandbox')">
            <input type="radio" name="orgType" value="sandbox" id="sandbox">
            <div class="option-content">
              <div class="option-title">Sandbox / Developer Edition</div>
              <div class="option-desc">Test environment or free developer org</div>
            </div>
          </label>

          <label class="option" onclick="selectOption('custom')">
            <input type="radio" name="orgType" value="custom" id="custom">
            <div class="option-content">
              <div class="option-title">Custom Domain (My Domain)</div>
              <div class="option-desc">Use your organization's custom Salesforce URL</div>
            </div>
          </label>
        </div>

        <div class="custom-domain" id="customDomainInput">
          <input
            type="text"
            id="customDomain"
            placeholder="mycompany.my.salesforce.com"
            pattern="[a-zA-Z0-9-]+\\.my\\.salesforce\\.com"
          />
        </div>

        <button type="submit" id="submitBtn" disabled>Connect to Salesforce</button>
      </form>

      <p class="help">Your data stays secure with Salesforce's OAuth 2.0</p>
    </div>

    <script>
      const returnUrl = ${JSON.stringify(returnUrlParam)};
      let selectedType = null;

      function selectOption(type) {
        selectedType = type;
        document.querySelectorAll('.option').forEach(opt => opt.classList.remove('selected'));
        document.querySelector('input[value="' + type + '"]').closest('.option').classList.add('selected');
        document.getElementById('submitBtn').disabled = false;

        const customInput = document.getElementById('customDomainInput');
        if (type === 'custom') {
          customInput.classList.add('visible');
          document.getElementById('customDomain').required = true;
        } else {
          customInput.classList.remove('visible');
          document.getElementById('customDomain').required = false;
        }
      }

      function handleSubmit(e) {
        e.preventDefault();

        let url = window.location.pathname + '?orgType=' + selectedType;

        if (selectedType === 'custom') {
          let domain = document.getElementById('customDomain').value.trim().toLowerCase();
          domain = domain.replace('https://', '').replace('http://', '');
          // Remove any trailing slashes and common salesforce domain suffixes
          domain = domain.replace(/\/+$/, '');
          domain = domain.replace(/\.(my\.)?salesforce\.com$/i, '');
          // Add the correct suffix
          domain = domain + '.my.salesforce.com';
          url += '&customDomain=' + encodeURIComponent(domain);
        }

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

    let salesforceBaseUrl: string
    if (orgType === 'production') {
      salesforceBaseUrl = 'https://login.salesforce.com'
    } else if (orgType === 'sandbox') {
      salesforceBaseUrl = 'https://test.salesforce.com'
    } else if (orgType === 'custom' && customDomain) {
      const cleanDomain = customDomain
        .toLowerCase()
        .trim()
        .replace('https://', '')
        .replace('http://', '')
      salesforceBaseUrl = `https://${cleanDomain}`
    } else {
      logger.error('Invalid org type or missing custom domain')
      return NextResponse.json({ error: 'Invalid org type' }, { status: 400 })
    }

    const baseUrl = getBaseUrl()
    const redirectUri = `${baseUrl}/api/auth/oauth2/callback/salesforce`

    const state = crypto.randomUUID()
    const { verifier, challenge } = await generatePKCE()

    const authParams = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SALESFORCE_SCOPES,
      state: state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'consent',
    })

    const oauthUrl = `${salesforceBaseUrl}/services/oauth2/authorize?${authParams.toString()}`

    logger.info('Initiating Salesforce OAuth:', {
      orgType,
      salesforceBaseUrl,
      redirectUri,
      returnUrl: returnUrl || 'not specified',
    })

    const response = NextResponse.redirect(oauthUrl)

    response.cookies.set('salesforce_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10,
      path: '/',
    })

    response.cookies.set('salesforce_pkce_verifier', verifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10,
      path: '/',
    })

    response.cookies.set('salesforce_base_url', salesforceBaseUrl, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10,
      path: '/',
    })

    if (returnUrl) {
      response.cookies.set('salesforce_return_url', returnUrl, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 10,
        path: '/',
      })
    }

    return response
  } catch (error) {
    logger.error('Error initiating Salesforce authorization:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
