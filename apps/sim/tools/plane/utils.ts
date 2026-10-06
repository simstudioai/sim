import { filterUndefined, isRecordLike } from '@sim/utils/object'
import { z } from 'zod'
import type { HttpRedirectPolicy } from '@/lib/core/security/http-redirect-policy'
import { readResponseToBufferWithLimit } from '@/lib/core/utils/stream-limits'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import type { PlaneDownloadedFile } from '@/tools/plane/types'
import type { OutputProperty } from '@/tools/types'
import { assertNoDotPathSegments, safeUrlPathSegment } from '@/tools/url-path'

export const PLANE_CREDENTIAL_PARAMS = {
  apiKey: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Plane personal access token from Profile → API tokens.',
  },
  baseUrl: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description:
      'Plane instance origin, optionally with a reverse-proxy path prefix. Defaults to https://api.plane.so. Do not include /api/v1 or /api/v2.',
  },
} as const

export const PLANE_VERSION_PARAM = {
  type: 'string',
  required: false,
  visibility: 'user-only',
  description:
    'API version: v2 (default) for Plane Cloud and current commercial instances; v1 for Community Edition or older self-hosted instances. Unsupported operations or fields fail explicitly.',
} as const

/** Resolves an explicit compatibility choice without inferring an edition from its hostname. */
export function planeApiVersion(value: unknown, supportsV1: boolean): 'v1' | 'v2' {
  if (value !== undefined && value !== '' && value !== 'v1' && value !== 'v2')
    throw new Error('Plane API version must be v1 or v2')
  if (value === 'v1' && !supportsV1)
    throw new Error(
      'This Plane operation requires API v2; select an operation supported by your instance'
    )
  return value === 'v1' ? 'v1' : 'v2'
}

/** Prevents silently discarding a field that belongs only to the other API version. */
export function assertPlaneVersionFields(
  params: object,
  selected: readonly string[],
  available: readonly string[],
  version: string
): void {
  for (const name of available) {
    if (!selected.includes(name) && Object.hasOwn(params, name)) {
      const value = Reflect.get(params, name)
      if (value !== undefined && value !== '')
        throw new Error(`${name} is not supported by Plane API ${version}`)
    }
  }
}

interface PlaneVersionField {
  key: string
  type: string
  required: boolean
  roleMap?: boolean
  emptyHtml?: boolean
}

/** Maps canonical inputs to the selected version's wire fields while preserving explicit clears and required fields. */
export function planeVersionedValues(
  params: object,
  fields: Record<string, PlaneVersionField>,
  overrides?: Record<string, unknown> | string
): Record<string, unknown> {
  let explicit: Record<string, unknown> = {}
  if (overrides !== undefined && overrides !== '') {
    const parsed = planeBodyValue(overrides, 'object', 'bodyOverrides')
    if (!isRecordLike(parsed)) throw new Error('bodyOverrides must be a JSON object')
    explicit = parsed
    for (const name of Object.keys(explicit)) {
      if (!Object.values(fields).some((field) => field.key === name))
        throw new Error(`bodyOverrides contains an unsupported field: ${name}`)
    }
  }
  const body: Record<string, unknown> = {}
  for (const [wireName, field] of Object.entries(fields)) {
    let value: unknown = Object.hasOwn(explicit, field.key)
      ? explicit[field.key]
      : Reflect.get(params, field.key)
    if (field.roleMap && typeof value === 'string') {
      const roles: Record<string, number> = { admin: 20, member: 15, guest: 5 }
      value = Object.hasOwn(roles, value) ? roles[value] : value
    }
    if (field.emptyHtml && value === '') value = '<p></p>'
    const parsed = planeBodyValue(value, field.type, field.key)
    if (field.required && (parsed === undefined || parsed === null || parsed === ''))
      throw new Error(`${field.key} is required for this Plane API version`)
    if (parsed !== undefined) body[wireName] = parsed
  }
  return body
}

/** Validates a v1 membership batch before its first write; v1 exposes separate add and remove APIs. */
export function planeMembershipChange(params: {
  add?: unknown
  remove?: unknown
  bodyOverrides?: Record<string, unknown> | string
}): { action: 'add' | 'remove'; ids: string[]; first: string } {
  const values = planeRequestBody(
    {
      add: planeBodyValue(params.add, 'array', 'add'),
      remove: planeBodyValue(params.remove, 'array', 'remove'),
    },
    params.bodyOverrides,
    { add: { type: 'array', required: false }, remove: { type: 'array', required: false } }
  )
  const add = z.array(z.string().min(1)).parse(values.add ?? [])
  const remove = z.array(z.string().min(1)).parse(values.remove ?? [])
  if (add.length && remove.length)
    throw new Error('Plane API v1 requires separate requests to add and remove work items')
  const ids = add.length ? add : remove
  for (const id of ids) safeUrlPathSegment(id, 'work item ID')
  const first = ids[0]
  if (!first) throw new Error('Provide work item IDs in add or remove')
  return { action: add.length ? 'add' : 'remove', ids, first }
}

const paginationSchema = z.object({
  next_cursor: z.string().nullable().optional(),
  prev_cursor: z.string().nullable().optional(),
  next_page_results: z.boolean().optional(),
  prev_page_results: z.boolean().optional(),
  count: z.number().optional(),
  total_pages: z.number().optional(),
  total_results: z.number().optional(),
  total_count: z.number().optional(),
  extra_stats: z.json().optional(),
  grouped_by: z.string().nullable().optional(),
  sub_grouped_by: z.string().nullable().optional(),
  total_groups: z.number().nullable().optional(),
  next_group_offset: z.number().nullable().optional(),
  sub_total_groups: z.number().nullable().optional(),
  sub_next_group_offset: z.number().nullable().optional(),
})

export type PlanePagination = z.output<typeof paginationSchema>

export const PLANE_PAGINATION_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Cursor pagination information. Bare-array responses have empty pagination.',
  properties: {
    next_cursor: {
      type: 'string',
      nullable: true,
      optional: true,
      description: 'Cursor for the next page.',
    },
    prev_cursor: {
      type: 'string',
      nullable: true,
      optional: true,
      description: 'Cursor for the previous page.',
    },
    next_page_results: {
      type: 'boolean',
      optional: true,
      description: 'Whether a next page exists.',
    },
    prev_page_results: {
      type: 'boolean',
      optional: true,
      description: 'Whether a previous page exists.',
    },
    count: { type: 'number', optional: true, description: 'Records on this page.' },
    total_pages: { type: 'number', optional: true, description: 'Total pages.' },
    total_results: { type: 'number', optional: true, description: 'Total records.' },
    total_count: {
      type: 'number',
      optional: true,
      description: 'Total records when supplied by this endpoint.',
    },
    extra_stats: {
      type: 'json',
      optional: true,
      description: 'Endpoint-specific aggregate statistics.',
    },
    grouped_by: { type: 'string', nullable: true, optional: true, description: 'Grouping field.' },
    sub_grouped_by: {
      type: 'string',
      nullable: true,
      optional: true,
      description: 'Secondary grouping field.',
    },
    total_groups: {
      type: 'number',
      nullable: true,
      optional: true,
      description: 'Total primary groups.',
    },
    next_group_offset: {
      type: 'number',
      nullable: true,
      optional: true,
      description: 'Next primary group offset.',
    },
    sub_total_groups: {
      type: 'number',
      nullable: true,
      optional: true,
      description: 'Total secondary groups.',
    },
    sub_next_group_offset: {
      type: 'number',
      nullable: true,
      optional: true,
      description: 'Next secondary group offset.',
    },
  },
}

/** Builds a Plane API URL while preserving self-hosted reverse-proxy prefixes. */
export function planeApiUrl(
  baseUrl: string | undefined,
  path: string,
  query: Record<string, unknown> = {}
): string {
  const input = baseUrl?.trim() || 'https://api.plane.so'
  assertNoDotPathSegments(input)
  const url = new URL(input)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Plane instance URL must be an HTTP(S) origin or path prefix without credentials, query, or fragment'
    )
  }
  if (/\/api\/v\d+(?:\/|$)/i.test(url.pathname)) {
    throw new Error('Plane instance URL must not include /api/v1 or another API version')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`
  const maxPerPage = path.includes('/api/v2/') ? Number.MAX_SAFE_INTEGER : 100
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    if (
      name === 'per_page' &&
      (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maxPerPage)
    ) {
      throw new Error(`per_page must be an integer between 1 and ${maxPerPage}`)
    }
    url.searchParams.set(
      name,
      Array.isArray(value)
        ? value.join(',')
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value)
    )
  }
  return url.toString()
}

/** Preserves omitted values and explicit clearing in Plane partial updates. */
export function planeBodyValue(value: unknown, type: string, name: string): unknown {
  if (value === undefined || value === null) return value
  if (type === 'array' || type === 'object') {
    let parsed = value
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value)
      } catch {
        throw new Error(`${name} must contain valid JSON`)
      }
    }
    if (type === 'array' ? !Array.isArray(parsed) : !isRecordLike(parsed)) {
      throw new Error(`${name} must be a JSON ${type}`)
    }
    return parsed
  }
  if (type === 'json') return z.json().parse(typeof value === 'string' ? JSON.parse(value) : value)
  if (type === 'number' || type === 'integer') {
    if (value === '') return undefined
    if (typeof value !== 'number' && typeof value !== 'string')
      throw new Error(`${name} must be a finite ${type}`)
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(parsed) || (type === 'integer' && !Number.isSafeInteger(parsed))) {
      throw new Error(`${name} must be a finite ${type}`)
    }
    return parsed
  }
  if (type === 'boolean') {
    if (value === '') return undefined
    if (value === true || value === 'true') return true
    if (value === false || value === 'false') return false
    throw new Error(`${name} must be true or false`)
  }
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  return value
}

interface PlaneBodyField {
  type: string
  required: boolean
}

/** Applies explicit clearing overrides only to fields owned by this API operation. */
export function planeRequestBody(
  values: Record<string, unknown>,
  overrides: Record<string, unknown> | string | undefined,
  fields: Record<string, PlaneBodyField>
): Record<string, unknown> {
  const body = filterUndefined(values)
  if (overrides !== undefined && overrides !== '') {
    const parsed = planeBodyValue(overrides, 'object', 'bodyOverrides')
    if (!isRecordLike(parsed)) throw new Error('bodyOverrides must be a JSON object')
    for (const [name, value] of Object.entries(parsed)) {
      const field = fields[name]
      if (!Object.hasOwn(fields, name) || !field)
        throw new Error(`bodyOverrides contains an unsupported field: ${name}`)
      body[name] = planeBodyValue(value, field.type, name)
    }
  }
  for (const [name, field] of Object.entries(fields)) {
    if (field.required && (body[name] === undefined || body[name] === null || body[name] === ''))
      throw new Error(`${name} is required`)
  }
  return body
}

export function planeHeaders(apiKey: string): Record<string, string> {
  const token = apiKey?.trim()
  if (!token || /[\r\n]/.test(token)) throw new Error('A valid Plane API token is required')
  return {
    'X-API-Key': token,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'Sim/1.0 (+https://sim.ai)',
  }
}

export function planeRedirectPolicy(): HttpRedirectPolicy {
  return {
    mode: 'standard',
    sendCredentialsOnCrossOriginRedirect: false,
    sensitiveHeaders: ['X-API-Key'],
  }
}

export async function planeObjectResponse<S extends z.ZodType>(
  response: Response,
  schema: S
): Promise<{ success: true; output: { result: z.output<S> } }> {
  const data: unknown = await response.json()
  return { success: true, output: { result: schema.parse(data) } }
}

export async function planeListResponse<S extends z.ZodType>(
  response: Response,
  schema: S,
  paginated: true,
  flatten: boolean
): Promise<{
  success: true
  output: { results: z.output<S>[]; detail?: string; pagination: PlanePagination }
}>
export async function planeListResponse<S extends z.ZodType>(
  response: Response,
  schema: S,
  paginated: false,
  flatten: boolean
): Promise<{ success: true; output: { results: z.output<S>[]; detail?: string } }>
export async function planeListResponse<S extends z.ZodType>(
  response: Response,
  schema: S,
  paginated: boolean,
  flatten: boolean
) {
  const data: unknown = await response.json()
  const detail = isRecordLike(data) && typeof data.detail === 'string' ? data.detail : undefined
  const values = Array.isArray(data)
    ? data
    : isRecordLike(data)
      ? Array.isArray(data.results)
        ? data.results
        : detail
          ? []
          : [data]
      : undefined
  if (!Array.isArray(values)) throw new Error('Plane returned an unexpected list response')
  const results = z.array(schema).parse(flatten ? values.flat(1) : values)
  if (paginated)
    return {
      success: true as const,
      output: {
        results,
        ...(detail === undefined ? {} : { detail }),
        pagination: paginationSchema.parse(Array.isArray(data) ? {} : data),
      },
    }
  return {
    success: true as const,
    output: { results, ...(detail === undefined ? {} : { detail }) },
  }
}

export async function planeFileResponse(
  response: Response
): Promise<{ success: true; output: { file: PlaneDownloadedFile } }> {
  const buffer = await readResponseToBufferWithLimit(response, {
    maxBytes: MAX_FILE_SIZE,
    label: 'Plane attachment',
  })
  const disposition = response.headers.get('content-disposition')
  const name = disposition?.match(/filename="([^"\r\n]+)"/i)?.[1] || 'attachment'
  return {
    success: true,
    output: {
      file: {
        name,
        mimeType: response.headers.get('content-type') || 'application/octet-stream',
        data: buffer,
        size: buffer.length,
      },
    },
  }
}
