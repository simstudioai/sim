import { db } from '@sim/db'
import { settings, user } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { adminMothershipQuerySchema } from '@/lib/api/contracts/mothership-tasks'
import { mothershipEnvironmentSchema } from '@/lib/api/contracts/user'
import { searchParamsToObject, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getMothershipBaseURL } from '@/lib/copilot/server/agent-url'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const ENV_URLS: Record<string, string | undefined> = {
  dev: env.MOTHERSHIP_DEV_URL,
  staging: env.MOTHERSHIP_STAGING_URL,
  prod: env.MOTHERSHIP_PROD_URL,
}

async function getMothershipUrl(environment: string, userId: string): Promise<string | null> {
  const parsedEnvironment = mothershipEnvironmentSchema.safeParse(environment)
  if (!parsedEnvironment.success) return ENV_URLS[environment] ?? null

  return getMothershipBaseURL({
    userId,
    environment: parsedEnvironment.data,
    fallbackUrl: ENV_URLS[environment],
  })
}

const ENDPOINT_PATTERN = /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/

function isValidEndpoint(endpoint: string): boolean {
  if (!endpoint) return false
  if (endpoint.includes('..')) return false
  return ENDPOINT_PATTERN.test(endpoint)
}

async function getAuthorizedAdminUserId() {
  const session = await getSession()
  if (!session?.user?.id) return null

  const [currentUser] = await db
    .select({
      role: user.role,
      superUserModeEnabled: settings.superUserModeEnabled,
    })
    .from(user)
    .leftJoin(settings, eq(settings.userId, user.id))
    .where(eq(user.id, session.user.id))
    .limit(1)

  const authorized = currentUser?.role === 'admin' && (currentUser.superUserModeEnabled ?? false)
  return authorized ? session.user.id : null
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
  const userId = await getAuthorizedAdminUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminKey = env.MOTHERSHIP_API_ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json({ error: 'MOTHERSHIP_API_ADMIN_KEY not configured' }, { status: 500 })
  }

  const { searchParams } = new URL(req.url)
  const queryValidation = adminMothershipQuerySchema.safeParse(searchParamsToObject(searchParams))
  if (!queryValidation.success) return validationErrorResponse(queryValidation.error)
  const { env: environment, endpoint } = queryValidation.data

  if (!isValidEndpoint(endpoint)) {
    return NextResponse.json({ error: 'invalid endpoint' }, { status: 400 })
  }

  const baseUrl = await getMothershipUrl(environment, userId)
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
        error: `Failed to reach mothership (${environment}): ${getErrorMessage(error, 'Unknown error')}`,
      },
      { status: 502 }
    )
  }
})

export const GET = withRouteHandler(async (req: NextRequest) => {
  const userId = await getAuthorizedAdminUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminKey = env.MOTHERSHIP_API_ADMIN_KEY
  if (!adminKey) {
    return NextResponse.json({ error: 'MOTHERSHIP_API_ADMIN_KEY not configured' }, { status: 500 })
  }

  const { searchParams } = new URL(req.url)
  const queryValidation = adminMothershipQuerySchema.safeParse(searchParamsToObject(searchParams))
  if (!queryValidation.success) return validationErrorResponse(queryValidation.error)
  const { env: environment, endpoint } = queryValidation.data

  if (!isValidEndpoint(endpoint)) {
    return NextResponse.json({ error: 'invalid endpoint' }, { status: 400 })
  }

  const baseUrl = await getMothershipUrl(environment, userId)
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
        error: `Failed to reach mothership (${environment}): ${getErrorMessage(error, 'Unknown error')}`,
      },
      { status: 502 }
    )
  }
})
