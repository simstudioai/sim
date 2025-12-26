import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('ShopifyAuthorize')

export const dynamic = 'force-dynamic'

const SHOPIFY_SCOPES = [
  'write_products',
  'write_orders',
  'write_customers',
  'write_inventory',
  'read_locations',
  'write_merchant_managed_fulfillment_orders',
].join(',')

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const clientId = env.SHOPIFY_CLIENT_ID

    if (!clientId) {
      logger.error('SHOPIFY_CLIENT_ID not configured')
      return NextResponse.json({ error: 'Shopify client ID not configured' }, { status: 500 })
    }

    const shopDomain = request.nextUrl.searchParams.get('shop')
    const returnUrl = request.nextUrl.searchParams.get('returnUrl')

    if (!shopDomain) {
      const returnUrlParam = returnUrl ? encodeURIComponent(returnUrl) : ''
      return new NextResponse(
        `<!DOCTYPE html>
<html>
  <head>
    <title>Connect Shopify Store</title>
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
        background: linear-gradient(135deg, #96BF48 0%, #5C8A23 100%);
      }
      .container {
        background: white;
        padding: 2rem;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        text-align: center;
        max-width: 400px;
        width: 90%;
      }
      h2 {
        color: #111827;
        margin: 0 0 0.5rem 0;
      }
      p {
        color: #6b7280;
        margin: 0 0 1.5rem 0;
      }
      input {
        width: 100%;
        padding: 0.75rem;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-size: 1rem;
        margin-bottom: 1rem;
        box-sizing: border-box;
      }
      input:focus {
        outline: none;
        border-color: #96BF48;
        box-shadow: 0 0 0 3px rgba(150, 191, 72, 0.2);
      }
      button {
        width: 100%;
        padding: 0.75rem;
        background: #96BF48;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        cursor: pointer;
        font-weight: 500;
      }
      button:hover {
        background: #7FA93D;
      }
      .help {
        font-size: 0.875rem;
        color: #9ca3af;
        margin-top: 1rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h2>Connect Your Shopify Store</h2>
      <p>Enter your Shopify store domain to continue</p>
      <form onsubmit="handleSubmit(event)">
        <input
          type="text"
          id="shop"
          placeholder="mystore.myshopify.com"
          required
          pattern="[a-zA-Z0-9-]+\\.myshopify\\.com"
        />
        <button type="submit">Connect Store</button>
      </form>
      <p class="help">Your store domain looks like: yourstore.myshopify.com</p>
    </div>

    <script>
      const returnUrl = '${returnUrlParam}';
      function handleSubmit(e) {
        e.preventDefault();
        let shop = document.getElementById('shop').value.trim().toLowerCase();

        // Clean up the shop domain
        shop = shop.replace('https://', '').replace('http://', '');
        if (!shop.endsWith('.myshopify.com')) {
          shop = shop.replace('.myshopify.com', '') + '.myshopify.com';
        }

        let url = window.location.pathname + '?shop=' + encodeURIComponent(shop);
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

    let cleanShop = shopDomain.toLowerCase().trim()
    cleanShop = cleanShop.replace('https://', '').replace('http://', '')
    if (!cleanShop.endsWith('.myshopify.com')) {
      cleanShop = `${cleanShop.replace('.myshopify.com', '')}.myshopify.com`
    }

    const baseUrl = getBaseUrl()
    const redirectUri = `${baseUrl}/api/auth/oauth2/callback/shopify`

    const state = crypto.randomUUID()

    const oauthUrl =
      `https://${cleanShop}/admin/oauth/authorize?` +
      new URLSearchParams({
        client_id: clientId,
        scope: SHOPIFY_SCOPES,
        redirect_uri: redirectUri,
        state: state,
      }).toString()

    logger.info('Initiating Shopify OAuth:', {
      shop: cleanShop,
      requestedScopes: SHOPIFY_SCOPES,
      redirectUri,
      returnUrl: returnUrl || 'not specified',
    })

    const response = NextResponse.redirect(oauthUrl)

    response.cookies.set('shopify_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10,
      path: '/',
    })

    response.cookies.set('shopify_shop_domain', cleanShop, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10,
      path: '/',
    })

    if (returnUrl) {
      response.cookies.set('shopify_return_url', returnUrl, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 10,
        path: '/',
      })
    }

    return response
  } catch (error) {
    logger.error('Error initiating Shopify authorization:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
