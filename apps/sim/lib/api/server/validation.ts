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

export async function parseJsonBody(
  request: Request,
  invalidJson: ParseRequestOptions['invalidJson'] = 'response'
): Promise<
  { success: true; data: unknown } | { success: false; response: NextResponse<{ error: string }> }
> {
  try {
    return { success: true, data: await request.json() }
  } catch (error) {
    if (invalidJson === 'throw') throw error
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
    const parsedBody = await parseJsonBody(request, options?.invalidJson)
    if (!parsedBody.success) {
      return options?.invalidJsonResponse
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
