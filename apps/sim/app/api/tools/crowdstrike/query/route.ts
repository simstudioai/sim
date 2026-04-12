import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateId } from '@/lib/core/utils/uuid'

const logger = createLogger('CrowdStrikeQueryAPI')

const CROWDSTRIKE_CLOUDS = ['us-1', 'us-2', 'eu-1', 'us-gov-1', 'us-gov-2'] as const
const CROWDSTRIKE_OPERATIONS = [
  'crowdstrike_query_behaviors',
  'crowdstrike_query_crowdscore',
  'crowdstrike_query_incidents',
  'crowdstrike_query_sensors',
] as const

const QuerySchema = z.object({
  operation: z.enum(CROWDSTRIKE_OPERATIONS),
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  cloud: z.enum(CROWDSTRIKE_CLOUDS),
  filter: z.string().nullish(),
  limit: z.number().int().positive().nullish(),
  offset: z.number().int().nonnegative().nullish(),
  sort: z.string().nullish(),
})

type QueryRequest = z.infer<typeof QuerySchema>
type JsonRecord = Record<string, unknown>

function getCloudBaseUrl(cloud: QueryRequest['cloud']): string {
  const cloudMap: Record<QueryRequest['cloud'], string> = {
    'eu-1': 'https://api.eu-1.crowdstrike.com',
    'us-1': 'https://api.crowdstrike.com',
    'us-2': 'https://api.us-2.crowdstrike.com',
    'us-gov-1': 'https://api.laggar.gcw.crowdstrike.com',
    'us-gov-2': 'https://api.us-gov-2.crowdstrike.mil',
  }

  return cloudMap[cloud]
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function getArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isJsonRecord)
}

function getResources(data: unknown): JsonRecord[] {
  const root = getResponseRoot(data)
  if (!isJsonRecord(root)) {
    return []
  }

  return getArray(root.resources)
}

function getResponseRoot(data: unknown): unknown {
  if (!isJsonRecord(data)) {
    return null
  }

  if (isJsonRecord(data.body)) {
    return data.body
  }

  return data
}

function getPagination(data: unknown) {
  const root = getResponseRoot(data)
  if (!isJsonRecord(root) || !isJsonRecord(root.meta) || !isJsonRecord(root.meta.pagination)) {
    return null
  }

  return {
    expiresAt: getNumber(root.meta.pagination.expires_at),
    limit: getNumber(root.meta.pagination.limit),
    offset:
      getNumber(root.meta.pagination.offset) ?? getString(root.meta.pagination.offset) ?? null,
    total: getNumber(root.meta.pagination.total),
  }
}

function getErrorMessage(data: unknown, fallback: string): string {
  if (!isJsonRecord(data)) {
    return fallback
  }

  const errors = Array.isArray(data.errors) ? data.errors : []
  const firstError = errors[0]
  if (isJsonRecord(firstError)) {
    const firstMessage = getString(firstError.message) ?? getString(firstError.code)
    if (firstMessage) {
      return firstMessage
    }
  }

  return (
    getString(data.message) ??
    getString(data.error_description) ??
    getString(data.error) ??
    fallback
  )
}

function buildOperationUrl(baseUrl: string, params: QueryRequest): string {
  const url = new URL(baseUrl)

  switch (params.operation) {
    case 'crowdstrike_query_sensors':
      url.pathname = '/identity-protection/queries/devices/v1'
      if (params.filter) url.searchParams.set('filter', params.filter)
      if (params.limit != null) url.searchParams.set('limit', params.limit.toString())
      if (params.offset != null) url.searchParams.set('offset', params.offset.toString())
      if (params.sort) url.searchParams.set('sort', params.sort)
      return url.toString()
    case 'crowdstrike_query_crowdscore':
      url.pathname = '/incidents/combined/crowdscores/v1'
      if (params.filter) url.searchParams.set('filter', params.filter)
      if (params.limit != null) url.searchParams.set('limit', params.limit.toString())
      if (params.offset != null) url.searchParams.set('offset', params.offset.toString())
      if (params.sort) url.searchParams.set('sort', params.sort)
      return url.toString()
    case 'crowdstrike_query_incidents':
      url.pathname = '/incidents/queries/incidents/v1'
      if (params.filter) url.searchParams.set('filter', params.filter)
      if (params.limit != null) url.searchParams.set('limit', params.limit.toString())
      if (params.offset != null) url.searchParams.set('offset', params.offset.toString())
      if (params.sort) url.searchParams.set('sort', params.sort)
      return url.toString()
    case 'crowdstrike_query_behaviors':
      url.pathname = '/incidents/queries/behaviors/v1'
      if (params.filter) url.searchParams.set('filter', params.filter)
      if (params.limit != null) url.searchParams.set('limit', params.limit.toString())
      if (params.offset != null) url.searchParams.set('offset', params.offset.toString())
      if (params.sort) url.searchParams.set('sort', params.sort)
      return url.toString()
  }

  throw new Error(`Unsupported CrowdStrike operation: ${params.operation}`)
}

async function getAccessToken(params: QueryRequest): Promise<string> {
  const baseUrl = getCloudBaseUrl(params.cloud)
  const response = await fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: 'client_credentials',
    }).toString(),
    cache: 'no-store',
  })

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(getErrorMessage(data, 'Failed to authenticate with CrowdStrike'))
  }

  if (!isJsonRecord(data) || typeof data.access_token !== 'string') {
    throw new Error('CrowdStrike authentication did not return an access token')
  }

  return data.access_token
}

function normalizeOutput(operation: QueryRequest['operation'], data: unknown) {
  const pagination = getPagination(data)

  switch (operation) {
    case 'crowdstrike_query_sensors': {
      const sensors = getResources(data).map((resource) => ({
        agentId: getString(resource.agent_id),
        hostname: getString(resource.hostname),
        ipAddress: getString(resource.ip_address),
        macAddress: getString(resource.mac_address),
      }))

      return {
        count: sensors.length,
        pagination,
        sensors,
      }
    }
    case 'crowdstrike_query_crowdscore': {
      const crowdScores = getResources(data).map((resource) => ({
        entityId: getString(resource.entity_uuid) ?? getString(resource.entity_id),
        entityType: getString(resource.entity_type),
        lastUpdated: getString(resource.last_updated),
        score: getNumber(resource.score) ?? getNumber(resource.crowdscore),
      }))

      return {
        count: crowdScores.length,
        crowdScores,
        pagination,
      }
    }
    case 'crowdstrike_query_incidents': {
      const incidents = getResources(data).map((resource) => ({
        createdTimestamp: getString(resource.created_timestamp),
        incidentId: getString(resource.incident_id),
        name: getString(resource.name),
        severity: getString(resource.severity),
        status: getString(resource.status),
      }))

      return {
        count: incidents.length,
        incidents,
        pagination,
      }
    }
    case 'crowdstrike_query_behaviors': {
      const behaviors = getResources(data).map((resource) => ({
        behaviorId: getString(resource.behavior_id),
        createdTimestamp: getString(resource.created_timestamp),
        incidentId: getString(resource.incident_id),
        name: getString(resource.name),
      }))

      return {
        behaviors,
        count: behaviors.length,
        pagination,
      }
    }
  }

  throw new Error(`Unsupported CrowdStrike operation: ${operation}`)
}

export async function POST(request: NextRequest) {
  const requestId = generateId().slice(0, 8)

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error || 'Unauthorized' },
      { status: 401 }
    )
  }

  try {
    const rawBody: unknown = await request.json()
    const params = QuerySchema.parse(rawBody)
    const baseUrl = getCloudBaseUrl(params.cloud)
    const accessToken = await getAccessToken(params)
    const apiUrl = buildOperationUrl(baseUrl, params)

    logger.info(`[${requestId}] CrowdStrike query`, {
      cloud: params.cloud,
      operation: params.operation,
    })

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    })

    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: getErrorMessage(data, 'CrowdStrike request failed'),
        },
        { status: response.status }
      )
    }

    return NextResponse.json({
      success: true,
      output: normalizeOutput(params.operation, data),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] CrowdStrike query failed`, { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
