import type { SapBaseParams } from '@/tools/sap_s4hana/types'

export const SAP_PROXY_URL = '/api/tools/sap_s4hana/proxy'

export function baseProxyBody(params: SapBaseParams) {
  const body: Record<string, unknown> = {}
  if (params.deploymentType) body.deploymentType = params.deploymentType
  if (params.authType) body.authType = params.authType
  if (params.subdomain) body.subdomain = params.subdomain
  if (params.region) body.region = params.region
  if (params.baseUrl) body.baseUrl = params.baseUrl
  if (params.tokenUrl) body.tokenUrl = params.tokenUrl
  if (params.clientId) body.clientId = params.clientId
  if (params.clientSecret) body.clientSecret = params.clientSecret
  if (params.username) body.username = params.username
  if (params.password) body.password = params.password
  return body
}

export function buildOdataQuery(opts: {
  filter?: string
  top?: number
  skip?: number
  orderBy?: string
  select?: string
  expand?: string
}): Record<string, string | number> {
  const query: Record<string, string | number> = { $format: 'json' }
  if (opts.filter) query.$filter = opts.filter
  if (typeof opts.top === 'number') query.$top = opts.top
  if (typeof opts.skip === 'number') query.$skip = opts.skip
  if (opts.orderBy) query.$orderby = opts.orderBy
  if (opts.select) query.$select = opts.select
  if (opts.expand) query.$expand = opts.expand
  return query
}

export function buildEntityQuery(opts: {
  select?: string
  expand?: string
}): Record<string, string> {
  const query: Record<string, string> = { $format: 'json' }
  if (opts.select) query.$select = opts.select
  if (opts.expand) query.$expand = opts.expand
  return query
}

export function parseJsonInput<T = unknown>(input: unknown, fieldName: string): T | undefined {
  if (input === undefined || input === null || input === '') {
    return undefined
  }
  if (typeof input === 'object') return input as T
  if (typeof input !== 'string') {
    throw new Error(`Invalid ${fieldName}: expected JSON object or string`)
  }
  try {
    return JSON.parse(input) as T
  } catch {
    throw new Error(`Invalid ${fieldName}: must be valid JSON`)
  }
}

export function quoteOdataKey(value: string): string {
  return `'${String(value).trim().replace(/'/g, "''")}'`
}

export interface SapProxyToolOutput {
  status: number
  data: unknown
}

export async function transformSapProxyResponse(
  response: Response
): Promise<{ success: boolean; output: SapProxyToolOutput; error?: string }> {
  const data = (await response.json().catch(() => ({}))) as {
    success?: boolean
    output?: SapProxyToolOutput
    error?: string
    status?: number
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.error || `SAP request failed: HTTP ${response.status}`)
  }

  return {
    success: true,
    output: data.output ?? { status: response.status, data: null },
  }
}
