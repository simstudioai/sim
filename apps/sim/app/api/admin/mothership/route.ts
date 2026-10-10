import { db } from '@sim/db'
import { settings, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { adminMothershipQuerySchema } from '@/lib/api/contracts/mothership-chats'
import { mothershipEnvironmentSchema } from '@/lib/api/contracts/user'
import { searchParamsToObject, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'

const logger = createLogger('AdminMothershipProxy')

const UPSTREAM_BODY_LOG_LIMIT = 500

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

/** `undefined` when the body is not JSON. Only called on a non-empty body. */
function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The upstream's own explanation, from either error envelope the admin API uses. */
function upstreamErrorMessage(data: unknown): string | undefined {
  if (!isRecordLike(data)) return undefined
  if (typeof data.error === 'string') return data.error
  if (typeof data.message === 'string') return data.message
  return undefined
}

type ProxyMethod = 'GET' | 'POST' | 'DELETE'

/**
 * Forwards to the mothership admin API. A 4xx passes through for the admin UI to show; an
 * upstream 5xx or unparseable body is a gateway failure, logged with its cause and answered
 * with 502 so it is not mistaken for a failure of this route.
 */
async function forwardToMothership(params: {
  method: ProxyMethod
  targetUrl: string
  adminKey: string
  environment: string
  endpoint: string
  body?: string
}) {
  const { method, targetUrl, adminKey, environment, endpoint, body } = params
  try {
    const upstream = await fetch(targetUrl, {
      method,
      headers: {
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        'x-api-key': adminKey,
      },
      ...(body ? { body } : {}),
    })
    const text = await upstream.text()
    if (!text && upstream.status < 500) {
      return new NextResponse(null, { status: upstream.status })
    }
    const data = text ? parseJsonText(text) : null

    if (upstream.status >= 500 || data === undefined) {
      logger.error('Mothership admin API request failed', {
        method,
        environment,
        endpoint,
        status: upstream.status,
        body: truncate(text, UPSTREAM_BODY_LOG_LIMIT),
      })
      return NextResponse.json(
        {
          error:
            upstreamErrorMessage(data) ??
            `Mothership (${environment}) returned HTTP ${upstream.status}${data === undefined ? ' with a non-JSON body' : ''}`,
        },
        { status: 502 }
      )
    }

    return NextResponse.json(data, { status: upstream.status })
  } catch (error) {
    logger.error('Failed to reach mothership admin API', {
      method,
      environment,
      endpoint,
      error: getErrorMessage(error, 'Unknown error'),
    })
    return NextResponse.json(
      {
        error: `Failed to reach mothership (${environment}): ${getErrorMessage(error, 'Unknown error')}`,
      },
      { status: 502 }
    )
  }
}

/**
 * Query params:
 *   env       - "dev" | "staging" | "prod"
 *   endpoint  - the admin endpoint path, e.g. "requests", "licenses", "traces"
 *
 * The request body (for POST) is forwarded as-is. For GET and DELETE, additional query
 * params (e.g. requestId for GET /traces) are forwarded.
 */
async function proxyAdminRequest(req: NextRequest, method: ProxyMethod) {
  const userId = await getAuthorizedAdminUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminKey = env.MOTHERSHIP_API_ADMIN_KEY
  if (!adminKey) {
    logger.error('MOTHERSHIP_API_ADMIN_KEY is not configured', { method })
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
  if (method !== 'POST') {
    searchParams.forEach((value, key) => {
      if (key !== 'env' && key !== 'endpoint') {
        forwardParams.set(key, value)
      }
    })
  }
  const qs = forwardParams.toString()

  return forwardToMothership({
    method,
    targetUrl: `${baseUrl}/api/admin/${endpoint}${qs ? `?${qs}` : ''}`,
    adminKey,
    environment,
    endpoint,
    ...(method === 'POST' ? { body: await req.text() } : {}),
  })
}

export const POST = withRouteHandler((req: NextRequest) => proxyAdminRequest(req, 'POST'))
export const GET = withRouteHandler((req: NextRequest) => proxyAdminRequest(req, 'GET'))
export const DELETE = withRouteHandler((req: NextRequest) => proxyAdminRequest(req, 'DELETE'))
