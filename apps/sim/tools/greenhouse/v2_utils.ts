import { isRecordLike, toArray, toRecord } from '@sim/utils/object'
import type { ToolOutputProperty } from '@/tools/types'

interface GreenhouseFieldRule {
  type: string
  required?: boolean
  minimum?: number
  maximum?: number
  maxItems?: number
  maxLength?: number
  enum?: readonly unknown[]
  integerItems?: boolean
  enumItems?: readonly string[]
}

/** Shared fields for a candidate's first application and a standalone application creation. */
export const GREENHOUSE_APPLICATION_FIELDS = {
  source_id: { type: 'integer' },
  recruiter_id: { type: 'integer' },
  coordinator_id: { type: 'integer' },
  referrer_id: { type: 'integer' },
  created_at: { type: 'string' },
  custom_fields: { type: 'array' },
  job_id: { type: 'integer' },
  initial_stage_id: { type: 'integer' },
  prospect: { type: 'boolean' },
  job_ids: { type: 'array', integerItems: true },
  prospect_pool_id: { type: 'integer' },
  prospect_pool_stage_id: { type: 'integer' },
  prospect_owner_id: { type: 'integer' },
  prospective_department_id: { type: 'integer' },
  prospective_office_id: { type: 'integer' },
} as const satisfies Record<string, GreenhouseFieldRule>

type GreenhouseValue<T> = T extends { type: 'string' }
  ? string
  : T extends { type: 'number' }
    ? number
    : T extends { type: 'boolean' }
      ? boolean
      : T extends { type: 'array'; items: infer I }
        ? GreenhouseValue<I>[]
        : T extends { properties: infer P }
          ? { [K in keyof P]: GreenhouseValue<P[K]> | null }
          : unknown

export type GreenhouseV2Output<T extends Record<string, ToolOutputProperty>> = {
  [K in keyof T]: GreenhouseValue<T[K]> | null
}

/** Projects documented fields, including nested records, without copying provider-only keys. */
export function mapGreenhouseFields<T extends Record<string, ToolOutputProperty>>(
  value: unknown,
  fields: T
): GreenhouseV2Output<T> {
  const record = toRecord(value)
  return Object.fromEntries(
    Object.entries(fields).map(([key, field]) => {
      const item = record[key]
      if (field.type === 'array') {
        if (item == null) return [key, null]
        if (!Array.isArray(item))
          throw new Error(`Greenhouse returned an invalid array field: ${key}`)
        const values = item
        const nested = field.items?.properties
        return [key, nested ? values.map((entry) => mapGreenhouseFields(entry, nested)) : values]
      }
      return [
        key,
        field.properties && item != null
          ? mapGreenhouseFields(item, field.properties)
          : (item ?? null),
      ]
    })
  ) as GreenhouseV2Output<T>
}

/** Standard Harvest v3 authentication; secrets are supplied by the OAuth executor. */
export function greenhouseHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
}

function fieldValue(value: unknown, name: string, rule: GreenhouseFieldRule): unknown {
  if (value === undefined || value === null || value === '') {
    if (rule.required) throw new Error(`${name} is required`)
    return undefined
  }
  let parsed = value
  if (rule.type === 'array' || rule.type === 'object') {
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch {
        throw new Error(`${name} must be valid JSON`)
      }
    }
    if (rule.type === 'array' ? !Array.isArray(parsed) : !isRecordLike(parsed)) {
      throw new Error(`${name} must be a JSON ${rule.type}`)
    }
    if (
      rule.type === 'array' &&
      rule.integerItems &&
      Array.isArray(parsed) &&
      parsed.some((entry) => !Number.isSafeInteger(entry))
    ) {
      throw new Error(`${name} must contain integer IDs`)
    }
  } else if (rule.type === 'integer' || rule.type === 'number') {
    if (typeof parsed !== 'number' && typeof parsed !== 'string') {
      throw new Error(`${name} must be a number`)
    }
    if (typeof parsed === 'string' && !parsed.trim()) throw new Error(`${name} must be a number`)
    const number = Number(parsed)
    if (!Number.isFinite(number) || (rule.type === 'integer' && !Number.isSafeInteger(number))) {
      throw new Error(
        `${name} must be a ${rule.type === 'integer' ? 'safe integer' : 'finite number'}`
      )
    }
    if (
      (rule.minimum !== undefined && number < rule.minimum) ||
      (rule.maximum !== undefined && number > rule.maximum)
    ) {
      throw new Error(`${name} is outside the supported range`)
    }
    parsed = number
  } else if (rule.type === 'boolean') {
    if (parsed === 'true') parsed = true
    if (parsed === 'false') parsed = false
    if (typeof parsed !== 'boolean') throw new Error(`${name} must be true or false`)
  } else if (rule.type === 'csv') {
    const values =
      typeof parsed === 'string' ? parsed.split(',').map((part) => part.trim()) : parsed
    if (!Array.isArray(values) || values.length === 0 || values.some((entry) => entry === '')) {
      throw new Error(`${name} must contain comma-separated values`)
    }
    if (rule.maxItems && values.length > rule.maxItems)
      throw new Error(`${name} accepts at most ${rule.maxItems} values`)
    for (const entry of values) {
      if (rule.integerItems && !/^\d+$/.test(String(entry)))
        throw new Error(`${name} must contain integer IDs`)
      if (rule.enumItems && !rule.enumItems.includes(String(entry)))
        throw new Error(`${name} contains an unsupported field`)
      if (typeof entry !== 'number' && typeof entry !== 'string')
        throw new Error(`${name} must contain scalar values`)
    }
    return values.join(',')
  } else if (typeof parsed !== 'string') {
    throw new Error(`${name} must be a string`)
  }
  if (rule.enum && !rule.enum.includes(parsed)) throw new Error(`${name} has an unsupported value`)
  if (typeof parsed === 'string' && rule.maxLength && parsed.length > rule.maxLength)
    throw new Error(`${name} is too long`)
  return parsed
}

/** Builds one page request. A cursor carries the initial filters and must be the sole parameter. */
export function greenhouseListUrl(
  resource: string,
  params: object,
  rules: Record<string, GreenhouseFieldRule>
): string {
  const input = toRecord(params)
  const url = new URL(`https://harvest.greenhouse.io/v3/${resource}`)
  if (typeof input.cursor === 'string' && input.cursor.trim()) {
    url.searchParams.set('cursor', input.cursor.trim())
    return url.toString()
  }
  for (const [key, rule] of Object.entries(rules)) {
    const value = fieldValue(input[key], key, rule)
    if (value === undefined) continue
    if (rule.type === 'object') {
      const parts: string[] = []
      for (const [operator, bound] of Object.entries(toRecord(value))) {
        if (
          !['gte', 'lte', 'gt', 'lt'].includes(operator) ||
          typeof bound !== 'string' ||
          !bound.trim()
        ) {
          throw new Error(`${key} must use gte, lte, gt, or lt with ISO 8601 values`)
        }
        parts.push(operator, bound)
      }
      if (parts.length > 0) url.searchParams.set(key, parts.join('|'))
    } else {
      url.searchParams.set(key, String(value))
    }
  }
  if (url.searchParams.has('created_at') && url.searchParams.has('updated_at'))
    throw new Error('created_at and updated_at cannot be combined')
  return url.toString()
}

function validateApplication(body: Record<string, unknown>): void {
  if (body.prospect === true) {
    if (body.job_id !== undefined || body.initial_stage_id !== undefined) {
      throw new Error(
        'Prospects use job_ids and prospect placement fields, not job_id or initial_stage_id'
      )
    }
    if (body.job_ids !== undefined)
      body.job_ids = fieldValue(body.job_ids, 'job_ids', { type: 'array', integerItems: true })
  } else {
    if (!Number.isSafeInteger(body.job_id) || Number(body.job_id) < 1)
      throw new Error('job_id is required for a candidate application')
    body.prospect = undefined
    for (const key of [
      'job_ids',
      'prospect_pool_id',
      'prospect_pool_stage_id',
      'prospect_owner_id',
      'prospective_department_id',
      'prospective_office_id',
    ]) {
      if (body[key] !== undefined) throw new Error(`${key} requires prospect=true`)
    }
  }
}

/** Validates the documented alternatives before constructing a provider mutation body. */
export function greenhouseBody(
  params: object,
  rules: Record<string, GreenhouseFieldRule>,
  operation: string
): Record<string, unknown> {
  const input = toRecord(params)
  const body: Record<string, unknown> = {}
  for (const [key, rule] of Object.entries(rules)) {
    const value = fieldValue(input[key], key, rule)
    if (value !== undefined) body[key] = value
  }
  if (operation === 'create_application') validateApplication(body)
  if (operation === 'create_candidate' && isRecordLike(body.application)) {
    body.application = greenhouseBody(
      body.application,
      GREENHOUSE_APPLICATION_FIELDS,
      'create_application'
    )
  }
  if (operation === 'create_attachment') {
    if (Boolean(body.content) === Boolean(body.url))
      throw new Error('Supply exactly one of attachment content or url')
  }
  if (operation === 'create_note') {
    if (body.note_type === 'EMAIL') {
      if (typeof body.subject !== 'string' || !body.subject.trim())
        throw new Error('subject is required for EMAIL notes')
      for (const key of ['email_from', 'email_to', 'email_cc']) {
        if (!Array.isArray(body[key])) throw new Error(`${key} is required for EMAIL notes`)
      }
    } else if (['email_from', 'email_to', 'email_cc'].some((key) => body[key] !== undefined)) {
      throw new Error('Email address fields are only accepted for EMAIL notes')
    }
  }
  if (operation.startsWith('update_') && Object.keys(body).length === 0)
    throw new Error('Supply at least one field to update')
  return body
}

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`Greenhouse returned invalid JSON (HTTP ${response.status})`)
  }
  if (!response.ok) {
    const record = toRecord(data)
    const message = typeof record.message === 'string' ? record.message : response.statusText
    const errors = toArray(record.errors)
    const detail = errors.length ? `: ${JSON.stringify(errors)}` : ''
    throw new Error(`Greenhouse API error (HTTP ${response.status}): ${message}${detail}`)
  }
  return data
}

/** Reads the v3 array response; malformed successful payloads must not look like an empty page. */
export async function readGreenhouseList(response: Response): Promise<Record<string, unknown>[]> {
  const data = await readResponse(response)
  if (!Array.isArray(data) || !data.every(isRecordLike))
    throw new Error('Greenhouse returned an invalid list response')
  return data
}

/** Resolves a resource fetched by the documented list endpoint's ids filter. */
export async function readGreenhouseSingle(response: Response): Promise<Record<string, unknown>> {
  const rows = await readGreenhouseList(response)
  if (rows.length !== 1 || typeof rows[0].id !== 'number')
    throw new Error('Greenhouse resource was not found or is not accessible')
  return rows[0]
}

/** Reads a mutation response with its endpoint-specific success marker. */
export async function readGreenhouseRecord(
  response: Response,
  marker = 'id'
): Promise<Record<string, unknown>> {
  const data = await readResponse(response)
  if (!isRecordLike(data) || data[marker] == null)
    throw new Error('Greenhouse returned an invalid resource response')
  const value = data[marker]
  const valid =
    marker === 'id'
      ? Number.isSafeInteger(value)
      : marker === 'message'
        ? typeof value === 'string' && value.length > 0
        : marker === 'candidate'
          ? isRecordLike(value) && Number.isSafeInteger(value.id)
          : false
  if (!valid) throw new Error('Greenhouse returned an invalid resource response')
  return data
}

/** Harvest transition actions intentionally return HTTP 204 with no JSON body. */
export async function readGreenhouseEmpty(response: Response): Promise<void> {
  if (!response.ok) await readResponse(response)
  if (response.status !== 204)
    throw new Error(`Expected Greenhouse HTTP 204, received ${response.status}`)
}

/** Extracts only the opaque cursor; requests never follow a provider-supplied destination URL. */
export function greenhousePagination(response: Response): {
  nextCursor: string | null
  hasMore: boolean
} {
  const next = response.headers.get('Link')?.match(/<([^>]+)>\s*;\s*rel="next"/i)
  if (!next) return { nextCursor: null, hasMore: false }
  const url = new URL(next[1])
  const nextCursor = url.searchParams.get('cursor')
  if (!nextCursor) throw new Error('Greenhouse returned a next-page link without a cursor')
  return { nextCursor, hasMore: true }
}
