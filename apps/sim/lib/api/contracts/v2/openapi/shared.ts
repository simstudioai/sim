import { z } from 'zod'
import { v2ErrorResponseSchema } from '@/lib/api/contracts/v2/shared'
import type {
  OpenApiErrorResponse,
  OpenApiHeader,
  OpenApiSecurityScheme,
} from '@/lib/api/openapi/types'

export const RATE_LIMIT_HEADERS = [
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
] as const

export const STANDARD_ERRORS = [
  'Unauthorized',
  'RateLimited',
  'InternalError',
  'ServiceUnavailable',
] as const

export const WORKSPACE_ERRORS = [
  'BadRequest',
  'Unauthorized',
  'Forbidden',
  'RateLimited',
  'InternalError',
  'ServiceUnavailable',
] as const

export const ERROR_RESPONSES = {
  BadRequest: { status: 400, description: 'The request is invalid.' },
  Unauthorized: { status: 401, description: 'The API key is missing or invalid.' },
  UsageLimitExceeded: {
    status: 402,
    description: 'The workspace has exceeded its usage or billing limits.',
  },
  Forbidden: { status: 403, description: 'The caller lacks access to the resource.' },
  NotFound: { status: 404, description: 'The requested resource was not found.' },
  Conflict: { status: 409, description: 'The request conflicts with current resource state.' },
  RunIdConflict: {
    status: 409,
    description: 'The run identifier is already associated with a different request.',
    headers: ['X-Run-Id'],
  },
  Gone: { status: 410, description: 'The requested generated resource has expired.' },
  PayloadTooLarge: { status: 413, description: 'The request body exceeds the allowed size.' },
  UnsupportedMediaType: {
    status: 415,
    description: 'The request uses an unsupported media type.',
  },
  Locked: { status: 423, description: 'The resource is locked and cannot be modified.' },
  RateLimited: {
    status: 429,
    description: 'The caller exceeded the request rate limit.',
    headers: ['Retry-After'],
  },
  InternalError: { status: 500, description: 'An unexpected server error occurred.' },
  ServiceUnavailable: {
    status: 503,
    description: 'A required service is temporarily unavailable.',
  },
} as const satisfies Readonly<Record<string, OpenApiErrorResponse>>

export type ErrorResponseId = keyof typeof ERROR_RESPONSES

export const V2_API_KEY_SECURITY = [{ apiKey: [] }] as const

export const V2_API_KEY_SECURITY_SCHEMES = {
  apiKey: {
    type: 'apiKey',
    in: 'header',
    name: 'X-API-Key',
    description:
      'Your Sim API key (personal or workspace). Generate one from the Sim dashboard under Settings > API Keys.',
  },
} as const satisfies Readonly<Record<string, OpenApiSecurityScheme>>

export const V2_COMMON_HEADERS = {
  'X-RateLimit-Limit': {
    schema: z.number().int().nonnegative().meta({
      id: 'RateLimitLimitHeader',
      title: 'Rate limit',
      description: 'Maximum requests allowed in the current window.',
    }),
  },
  'X-RateLimit-Remaining': {
    schema: z.number().int().nonnegative().meta({
      id: 'RateLimitRemainingHeader',
      title: 'Rate limit remaining',
      description: 'Requests remaining in the current window.',
    }),
  },
  'X-RateLimit-Reset': {
    schema: z.string().datetime().meta({
      id: 'RateLimitResetHeader',
      title: 'Rate limit reset',
      description: 'ISO 8601 timestamp when the current rate-limit window resets.',
    }),
  },
  'Retry-After': {
    schema: z.number().int().nonnegative().meta({
      id: 'RetryAfterHeader',
      title: 'Retry after',
      description: 'Seconds to wait before retrying a rate-limited request.',
    }),
  },
  'X-Run-Id': {
    schema: z.string().min(1).meta({
      id: 'RunIdHeader',
      title: 'Run identifier',
      description: 'Identifier assigned to the workflow run.',
    }),
  },
} as const satisfies Readonly<Record<string, OpenApiHeader>>

export const V2_ERROR_SCHEMA = v2ErrorResponseSchema.meta({
  id: 'V2Error',
  title: 'v2 error response',
  description: 'Canonical error envelope returned by the public v2 API.',
  examples: [{ error: { code: 'BAD_REQUEST', message: 'The request is invalid.' } }],
})

export function documentedSchema<S extends z.ZodType | undefined>(
  schema: S,
  id: string,
  title: string,
  description: string,
  examples?: readonly unknown[]
): Exclude<S, undefined> {
  if (!schema) throw new Error(`Cannot document missing schema ${id}`)
  return schema.meta({ id, title, description, ...(examples ? { examples } : {}) }) as Exclude<
    S,
    undefined
  >
}
