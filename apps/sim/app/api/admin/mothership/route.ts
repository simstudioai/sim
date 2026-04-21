import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const ENV_URLS: Record<string, string | undefined> = {
  dev: env.MOTHERSHIP_DEV_URL,
  staging: env.MOTHERSHIP_STAGING_URL,
  prod: env.MOTHERSHIP_PROD_URL,
}

function getMothershipUrl(environment: string): string | null {
  return ENV_URLS[environment] ?? null
}

async function isAdminRequestAuthorized() {
  const session = await getSession()
  if (!session?.user?.id) return false

  const [currentUser] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1)

  return currentUser?.role === 'admin'
}

/**
 * Proxy to the mothership admin API.
 *
 * Query params:
 *   env       - "dev" | "staging" | "prod"
 *   endpoint  - the admin endpoint path, e.g. "requests", "licenses", "traces"
 *
 * The request body (for POST) is forwarded as-is. Additional query params
 * (e.g. requestId for GET /traces) are forwarded.
 */
export const POST = withRouteHandler(async (req: NextRequest) => {
  if (!(await isAdminRequestAuthorized())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminKey = env.MOTHERSHIP_API_ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json({ error: 'MOTHERSHIP_API_ADMIN_KEY not configured' }, { status: 500 })
  }

  const { searchParams } = new URL(req.url)
  const environment = searchParams.get('env') || 'dev'
  const endpoint = searchParams.get('endpoint')

  if (!endpoint) {
    return NextResponse.json({ error: 'endpoint query param required' }, { status: 400 })
  }

  const baseUrl = getMothershipUrl(environment)
  if (!baseUrl) {
    return NextResponse.json(
      { error: `No URL configured for environment: ${environment}` },
      { status: 400 }
    )
  }

  const targetUrl = `${baseUrl}/api/admin/${endpoint}`

  try {
    const body = await req.text()
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': adminKey,
      },
      ...(body ? { body } : {}),
    })

    const data = await upstream.json()
    return NextResponse.json(data, { status: upstream.status })
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to reach mothership (${environment}): ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 502 }
    )
  }
})

export const GET = withRouteHandler(async (req: NextRequest) => {
  if (!(await isAdminRequestAuthorized())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminKey = env.MOTHERSHIP_API_ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json({ error: 'MOTHERSHIP_API_ADMIN_KEY not configured' }, { status: 500 })
  }

  const { searchParams } = new URL(req.url)
  const environment = searchParams.get('env') || 'dev'
  const endpoint = searchParams.get('endpoint')

  if (!endpoint) {
    return NextResponse.json({ error: 'endpoint query param required' }, { status: 400 })
  }

  const baseUrl = getMothershipUrl(environment)
  if (!baseUrl) {
    return NextResponse.json(
      { error: `No URL configured for environment: ${environment}` },
      { status: 400 }
    )
  }

  const forwardParams = new URLSearchParams()
  searchParams.forEach((value, key) => {
    if (key !== 'env' && key !== 'endpoint') {
      forwardParams.set(key, value)
    }
  })

  const qs = forwardParams.toString()
  const targetUrl = `${baseUrl}/api/admin/${endpoint}${qs ? `?${qs}` : ''}`

  try {
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'x-api-key': adminKey },
    })

    const data = await upstream.json()
    return NextResponse.json(data, { status: upstream.status })
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to reach mothership (${environment}): ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 502 }
    )
  }
})
