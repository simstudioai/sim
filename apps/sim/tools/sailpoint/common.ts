import { toError } from '@sim/utils/errors'
import { filterUndefined } from '@sim/utils/object'
import type { ToolConfig, ToolOutputProperty } from '@/tools/types'

/** Credentials shared by every SailPoint Identity Security Cloud operation. */
export const sailpointCredentialParams = {
  clientId: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'SailPoint Personal Access Token client ID',
  },
  clientSecret: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'SailPoint Personal Access Token client secret',
  },
  tenant: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description:
      'SailPoint tenant name or full *.api.identitynow.com / *.api.identitynowgov.com host',
  },
} as const satisfies ToolConfig['params']

/** Standard collection pagination used by SailPoint service-semver list APIs. */
export const sailpointPaginationParams = {
  limit: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Maximum records for this page (0-250; default 250)',
  },
  offset: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Zero-based record offset (default 0)',
  },
  count: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Return the total matching count in X-Total-Count (default false)',
  },
} as const satisfies ToolConfig['params']

/** Role collections have a provider-specific page limit of 50. */
export const sailpointRolePaginationParams = {
  limit: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Maximum roles for this page (0-50; default 50)',
  },
  offset: sailpointPaginationParams.offset,
  count: sailpointPaginationParams.count,
} as const satisfies ToolConfig['params']

interface SailPointCredentialsLike {
  clientId: string
  clientSecret: string
  tenant: string
}

/** Builds the private input consumed by the SailPoint internal operation handler. */
export function createSailPointOperationInput(
  operation: string,
  params: SailPointCredentialsLike,
  input: Record<string, unknown> = {}
): Record<string, unknown> {
  const clientId = requireNonEmptyString(params.clientId, 'Client ID')
  const clientSecret = requireNonEmptyString(params.clientSecret, 'Client secret')
  const tenant = requireNonEmptyString(params.tenant, 'Tenant')
  return filterUndefined({ operation, clientId, clientSecret, tenant, ...input })
}

/** Trims a required string and rejects empty or whitespace-only values. */
export function requireNonEmptyString(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

/** Trims an optional string and omits empty or whitespace-only values. */
export function optionalNonEmptyString(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

/** Accepts a native JSON value or its serialized representation. */
export function parseJsonValue<T>(value: T | string | undefined, label: string): T | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed) as T
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

/** Normalizes an array, JSON array, or comma-separated string to non-empty strings. */
export function normalizeStringList(
  value: string[] | string | undefined,
  label: string,
  options: { required?: boolean; maxItems?: number } = {}
): string[] | undefined {
  if (value === undefined) {
    if (options.required) throw new Error(`${label} is required`)
    return undefined
  }

  let values: unknown
  if (Array.isArray(value)) {
    values = value
  } else {
    const trimmed = value.trim()
    if (!trimmed) values = []
    else if (trimmed.startsWith('[')) values = parseJsonValue<unknown[]>(trimmed, label)
    else values = trimmed.split(',')
  }

  if (!Array.isArray(values)) throw new Error(`${label} must be an array of strings`)
  const normalized = values.map((entry) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(`${label} must contain only non-empty strings`)
    }
    return entry.trim()
  })
  if (options.required && normalized.length === 0) throw new Error(`${label} is required`)
  if (options.maxItems !== undefined && normalized.length > options.maxItems) {
    throw new Error(`${label} must contain at most ${options.maxItems} entries`)
  }
  return normalized.length ? normalized : undefined
}

/** Validates one SailPoint offset page without automatically materializing additional pages. */
export function validatePagination(
  limit: number | undefined,
  offset: number | undefined,
  maxLimit = 250
): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0 || limit > maxLimit)) {
    throw new Error(`Limit must be an integer between 0 and ${maxLimit}`)
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    throw new Error('Offset must be an integer greater than or equal to 0')
  }
}

/** Rejects combinations that SailPoint documents as mutually exclusive. */
export function assertMutuallyExclusive(
  values: ReadonlyArray<readonly [string, unknown]>,
  message?: string
): void {
  const present = values.filter(
    ([, value]) => value !== undefined && value !== null && value !== ''
  )
  if (present.length > 1) {
    throw new Error(message ?? `${present.map(([name]) => name).join(', ')} are mutually exclusive`)
  }
}

/** Standard operation response envelope produced by the internal SailPoint handler. */
export async function unwrapSailPointOutput<T = Record<string, unknown>>(
  response: Response,
  fallbackError = 'SailPoint request failed'
): Promise<{ success: true; output: T }> {
  let data: { success?: boolean; output?: T; error?: unknown } | null
  try {
    data = (await response.json()) as { success?: boolean; output?: T; error?: unknown }
  } catch (error) {
    const normalized = toError(error)
    if (normalized.name === 'AbortError') throw error
    data = null
  }

  if (!response.ok || !data || data.success === false) {
    const message = typeof data?.error === 'string' && data.error ? data.error : fallbackError
    throw new Error(message)
  }

  return { success: true, output: (data.output ?? {}) as T }
}

/** Operation-specific list output with typed item properties. */
export function createSailPointListOutputs(
  itemProperties: Record<string, ToolOutputProperty>,
  description: string
): ToolConfig['outputs'] {
  return {
    items: {
      type: 'array',
      description,
      items: { type: 'object', properties: itemProperties },
    },
    count: { type: 'number', description: 'Number of records returned in this page' },
    totalCount: {
      type: 'number',
      description: 'Total matching records when count=true',
      optional: true,
      nullable: true,
    },
  }
}

/** Operation-specific resource output with documented top-level properties. */
export function createSailPointResourceOutput(
  key: string,
  properties: Record<string, ToolOutputProperty>,
  description: string
): ToolConfig['outputs'] {
  return { [key]: { type: 'object', description, properties } }
}

export const sailpointAcceptedOutputs = {
  accepted: { type: 'boolean', description: 'Whether SailPoint accepted the asynchronous action' },
  status: { type: 'number', description: 'Provider response status (normally 202)' },
} as const satisfies ToolConfig['outputs']
