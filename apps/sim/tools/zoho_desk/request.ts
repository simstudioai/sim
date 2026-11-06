import { isRecordLike } from '@sim/utils/object'
import type { ToolConfig, ToolOutputProperty } from '@/tools/types'
import {
  getZohoDeskErrorMessage,
  normalizeZohoDeskCommaList,
  withDerivedContentText,
} from '@/tools/zoho_desk/utils'

export const ZOHO_DESK_AUTH_PARAMS = {
  accessToken: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Zoho Desk OAuth access token',
  },
  apiDomain: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Zoho Desk data-center REST base URL',
  },
  orgId: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Zoho Desk organization ID',
  },
} as const satisfies ToolConfig['params']

/** Omit untouched workflow fields without discarding explicit clears or false values. */
export function buildZohoDeskBody(fields: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) body[key] = value
  }
  if (Object.keys(body).length === 0) throw new Error('Provide at least one field to change.')
  return body
}

/** Parse a resolved JSON input and enforce its documented top-level shape. */
export function parseZohoDeskJson(
  value: unknown,
  name: string,
  shape: 'object' | 'array'
): unknown {
  if (value === undefined || value === null || value === '') return undefined
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error(`${name} must contain valid JSON`)
    }
  }
  if (shape === 'array' ? !Array.isArray(parsed) : !isRecordLike(parsed)) {
    throw new Error(`${name} must be a JSON ${shape}`)
  }
  return parsed
}

/** Read a successful provider object, preserving HTTP failures and malformed-body errors. */
export async function readZohoDeskResponse(response: Response): Promise<Record<string, unknown>> {
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error(
      response.ok
        ? 'Zoho Desk returned an invalid JSON response'
        : `Zoho Desk request failed (HTTP ${response.status})`
    )
  }
  if (!response.ok)
    throw new Error(
      getZohoDeskErrorMessage(data, `Zoho Desk request failed (HTTP ${response.status})`)
    )
  if (!isRecordLike(data) || Object.keys(data).length === 0)
    throw new Error('Zoho Desk returned an invalid object response')
  return data
}

/** Read one bounded list page; a search total is distinct from the returned page length. */
export async function readZohoDeskList(
  response: Response
): Promise<{ items: Record<string, unknown>[]; totalCount: number | null }> {
  if (response.status === 204) return { items: [], totalCount: null }
  const data = await readZohoDeskResponse(response)
  if (!Array.isArray(data.data) || !data.data.every(isRecordLike))
    throw new Error('Zoho Desk returned an invalid list response')
  const count = data.count == null ? null : Number(data.count)
  return { items: data.data, totalCount: count !== null && Number.isFinite(count) ? count : null }
}

/** Project documented fields and explicitly selected portal fields, preserving custom-field maps. */
export function projectZohoDeskResource(
  data: Record<string, unknown>,
  properties: Record<string, ToolOutputProperty>,
  selectedFields?: string
): Record<string, unknown> {
  const derived = withDerivedContentText(data)
  if (!isRecordLike(derived)) throw new Error('Zoho Desk returned an invalid resource')
  const requestedFields = normalizeZohoDeskCommaList(selectedFields)?.split(',') ?? []
  const result: Record<string, unknown> = Object.fromEntries(
    requestedFields.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]])
  )
  for (const [key, property] of Object.entries(properties)) {
    const value = derived[key]
    if (value === undefined) continue
    if (property.properties && isRecordLike(value)) {
      result[key] = projectZohoDeskResource(value, property.properties)
    } else if (property.items?.properties && Array.isArray(value)) {
      const itemProperties = property.items.properties
      result[key] = value.map((item) =>
        isRecordLike(item) ? projectZohoDeskResource(item, itemProperties) : item
      )
    } else result[key] = value
  }
  return result
}
