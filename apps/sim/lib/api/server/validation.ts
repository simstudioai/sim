import { type NextRequest, NextResponse } from 'next/server'
import { ZodError, type z } from 'zod'
import type {
  AnyApiRouteContract,
  ApiSchema,
  ContractBody,
  ContractHeaders,
  ContractParams,
  ContractQuery,
} from '@/lib/api/contracts'
import { env } from '@/lib/core/config/env'
import {
  assertContentLengthWithinLimit,
  isPayloadSizeLimitError,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'

/**
 * Default upper bound on the JSON request body that contract routes will read
 * and parse into memory. Next.js App Router imposes no body cap, so without
 * this an unauthenticated caller could buffer an arbitrarily large body before
 * schema validation runs. Override per-route via `ParseRequestOptions.maxBodyBytes`.
 * Falls back to 50 MB if the env value is missing or non-numeric so a misconfig
 * can never silently disable the cap (a NaN limit would never reject).
 */
export const DEFAULT_MAX_JSON_BODY_BYTES =
  Number.parseInt(env.API_MAX_JSON_BODY_BYTES, 10) || 50 * 1024 * 1024

export interface ValidationErrorBody {
  error: string
  details: z.core.$ZodIssue[]
}

type ValidationResult<S extends ApiSchema> =
  | { success: true; data: z.output<S> }
  | { success: false; response: NextResponse<unknown>; error: z.ZodError }

export interface ParsedRequest<C extends AnyApiRouteContract> {
  params: ContractParams<C>
  query: ContractQuery<C>
  body: ContractBody<C>
  headers: ContractHeaders<C>
}

interface RouteContextWithParams {
  params?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>
}

export interface ParseRequestOptions {
  validationErrorResponse?: (error: z.ZodError) => NextResponse<unknown>
  invalidJsonResponse?: () => NextResponse<unknown>
  invalidJson?: 'response' | 'throw'
  /**
   * Maximum number of bytes to read for the JSON body before rejecting with a
   * 413. Defaults to {@link DEFAULT_MAX_JSON_BODY_BYTES}. Raise this only for
   * routes that legitimately accept large JSON payloads (e.g. inline file uploads).
   */
  maxBodyBytes?: number
}

export function serializeZodIssues(error: z.ZodError): z.core.$ZodIssue[] {
  return error.issues
}

export function isZodError(error: unknown): error is z.ZodError {
  return error instanceof ZodError
}

export function validationErrorResponse(
  error: z.ZodError,
  message = 'Validation error',
  status = 400
): NextResponse<ValidationErrorBody> {
  return NextResponse.json({ error: message, details: serializeZodIssues(error) }, { status })
}

export function getValidationErrorMessage(
  error: z.ZodError,
  fallback = 'Invalid request data'
): string {
  return error.issues[0]?.message || fallback
}

export function validationErrorResponseFromError(
  error: unknown,
  message = 'Validation error',
  status = 400
): NextResponse<ValidationErrorBody> | null {
  if (!isZodError(error)) return null
  return validationErrorResponse(error, message, status)
}

const REQUEST_BODY_LABEL = 'Request body'

/**
 * Reads the JSON body while enforcing a byte cap. The body is read through a
 * size-limited stream so chunked/streamed bodies are bounded even when the
 * `content-length` header is absent or lies about the true size. When no
 * readable stream is available (e.g. a mocked request) the content-length guard
 * is the only bound and parsing falls back to {@link Request.json}. Decoding
 * uses {@link TextDecoder} so a leading UTF-8 BOM is stripped, matching the spec
 * "UTF-8 decode" behavior of `request.json()`.
 */
async function readJsonBodyWithLimit(request: Request, maxBytes: number): Promise<unknown> {
  assertContentLengthWithinLimit(request.headers, maxBytes, REQUEST_BODY_LABEL)

  const stream = request.body
  if (!stream) {
    return request.json()
  }

  const buffer = await readStreamToBufferWithLimit(stream, {
    maxBytes,
    label: REQUEST_BODY_LABEL,
  })
  return JSON.parse(new TextDecoder().decode(buffer))
}

export async function parseJsonBody(
  request: Request,
  invalidJson: ParseRequestOptions['invalidJson'] = 'response',
  maxBytes: number = DEFAULT_MAX_JSON_BODY_BYTES
): Promise<
  | { success: true; data: unknown }
  | {
      success: false
      reason: 'too_large' | 'invalid_json'
      response: NextResponse<{ error: string }>
    }
> {
  try {
    return { success: true, data: await readJsonBodyWithLimit(request, maxBytes) }
  } catch (error) {
    if (invalidJson === 'throw') throw error
    if (isPayloadSizeLimitError(error)) {
      return {
        success: false,
        reason: 'too_large',
        response: NextResponse.json(
          { error: `Request body exceeds the maximum allowed size of ${maxBytes} bytes` },
          { status: 413 }
        ),
      }
    }
    return {
      success: false,
      reason: 'invalid_json',
      response: NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 }),
    }
  }
}

/**
 * Reads an entirely optional JSON body with the standard byte cap. An absent
 * or empty body resolves to `{ success: true, data: undefined }`; malformed
 * JSON and oversized payloads return the standard 400/413 error responses.
 * Use for endpoints whose body may be omitted altogether (e.g. optional
 * metadata on a deploy call) — `parseJsonBody` rejects empty bodies.
 */
export async function parseOptionalJsonBody(
  request: Request,
  maxBytes: number = DEFAULT_MAX_JSON_BODY_BYTES
): Promise<
  { success: true; data: unknown } | { success: false; response: NextResponse<{ error: string }> }
> {
  try {
    assertContentLengthWithinLimit(request.headers, maxBytes, REQUEST_BODY_LABEL)

    const stream = request.body
    const text = stream
      ? new TextDecoder().decode(
          await readStreamToBufferWithLimit(stream, { maxBytes, label: REQUEST_BODY_LABEL })
        )
      : await request.text()

    if (!text.trim()) {
      return { success: true, data: undefined }
    }
    return { success: true, data: JSON.parse(text) }
  } catch (error) {
    if (isPayloadSizeLimitError(error)) {
      return {
        success: false,
        response: NextResponse.json(
          { error: `Request body exceeds the maximum allowed size of ${maxBytes} bytes` },
          { status: 413 }
        ),
      }
    }
    return {
      success: false,
      response: NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 }),
    }
  }
}

export function searchParamsToObject(
  searchParams: URLSearchParams
): Record<string, string | string[]> {
  const output: Record<string, string | string[]> = {}

  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key)
    output[key] = values.length > 1 ? values : (values[0] ?? '')
  }

  return output
}

export function headersToObject(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {}
  headers.forEach((value, key) => {
    output[key] = value
  })
  return output
}

async function parseContextParams<TContext>(
  context: TContext
): Promise<Record<string, string | string[] | undefined>> {
  const candidate = context as RouteContextWithParams
  if (!candidate.params) return {}
  return await candidate.params
}

function shouldReadJsonBody<C extends AnyApiRouteContract>(contract: C): boolean {
  return Boolean(contract.body) && contract.method !== 'GET'
}

export async function parseRequest<C extends AnyApiRouteContract, TContext>(
  contract: C,
  request: NextRequest,
  context: TContext,
  options?: ParseRequestOptions
): Promise<
  { success: true; data: ParsedRequest<C> } | { success: false; response: NextResponse<unknown> }
> {
  const rawParams = await parseContextParams(context)
  const rawQuery = searchParamsToObject(request.nextUrl.searchParams)
  const rawHeaders = headersToObject(request.headers)

  let body: unknown
  if (shouldReadJsonBody(contract)) {
    const parsedBody = await parseJsonBody(request, options?.invalidJson, options?.maxBodyBytes)
    if (!parsedBody.success) {
      return options?.invalidJsonResponse && parsedBody.reason === 'invalid_json'
        ? { success: false, response: options.invalidJsonResponse() }
        : parsedBody
    }
    body = parsedBody.data
  }

  const params = contract.params
    ? validateRequestSchema(contract.params, rawParams, options)
    : undefined
  if (params && !params.success) return params

  const query = contract.query
    ? validateRequestSchema(contract.query, rawQuery, options)
    : undefined
  if (query && !query.success) return query

  const headers = contract.headers
    ? validateRequestSchema(contract.headers, rawHeaders, options)
    : undefined
  if (headers && !headers.success) return headers

  const parsedBody = contract.body ? validateRequestSchema(contract.body, body, options) : undefined
  if (parsedBody && !parsedBody.success) return parsedBody

  return {
    success: true,
    data: {
      params: params?.data as ContractParams<C>,
      query: query?.data as ContractQuery<C>,
      headers: headers?.data as ContractHeaders<C>,
      body: parsedBody?.data as ContractBody<C>,
    },
  }
}

function validateRequestSchema<S extends ApiSchema>(
  schema: S,
  data: unknown,
  options?: ParseRequestOptions
): ValidationResult<S> {
  const result = schema.safeParse(data)
  if (!result.success) {
    return {
      success: false,
      response: options?.validationErrorResponse
        ? options.validationErrorResponse(result.error)
        : validationErrorResponse(result.error),
      error: result.error,
    }
  }

  return { success: true, data: result.data }
}
