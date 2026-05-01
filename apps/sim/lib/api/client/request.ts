import { ApiClientError } from '@/lib/api/client/errors'
import type {
  AnyApiRouteContract,
  ApiSchema,
  ContractBodyInput,
  ContractHeadersInput,
  ContractJsonResponse,
  ContractParamsInput,
  ContractQueryInput,
  EmptySchemaOutput,
} from '@/lib/api/contracts'

// Tuple-wrapped to suppress distributive conditionals: when `Value` is a
// union (e.g. a discriminated union body), naked `Value extends undefined`
// distributes and produces `{ body: A } | { body: B }` instead of
// `{ body: A | B }`. The `[Value] extends [undefined]` form preserves the
// union as-is. See request.test.ts for repro and rationale.
type MaybeField<Key extends string, Value> = [Value] extends [undefined]
  ? { [K in Key]?: never }
  : { [K in Key]: Value }

export type ApiClientRequest<C extends AnyApiRouteContract> = MaybeField<
  'params',
  ContractParamsInput<C>
> &
  MaybeField<'query', ContractQueryInput<C>> &
  MaybeField<'body', ContractBodyInput<C>> &
  MaybeField<'headers', ContractHeadersInput<C>> & {
    signal?: AbortSignal
  }

export interface ApiRawRequestOptions {
  cache?: RequestCache
  headers?: Record<string, string>
}

function replacePathParams(path: string, params: unknown): string {
  if (!params || typeof params !== 'object') return path

  const values = params as Record<string, unknown>
  return path.replace(
    /\[\[?(\.\.\.)?([^\][]+)\]\]?/g,
    (match, rest: string | undefined, key: string) => {
      const value = values[key]
      const isOptionalCatchAll = match.startsWith('[[...')

      if (rest && Array.isArray(value)) {
        return value.map((item) => encodeURIComponent(String(item))).join('/')
      }

      if (value === undefined && isOptionalCatchAll) return ''

      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(`Missing route param "${key}"`)
      }

      return encodeURIComponent(String(value))
    }
  )
}

function appendQuery(path: string, query: unknown): string {
  if (!query || typeof query !== 'object') return path

  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || value === null || value === '') continue

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== '') {
          searchParams.append(key, String(item))
        }
      }
      continue
    }

    if (typeof value === 'object') {
      searchParams.set(key, JSON.stringify(value))
      continue
    }

    searchParams.set(key, String(value))
  }

  const queryString = searchParams.toString()
  if (!queryString) return path

  return `${path}${path.includes('?') ? '&' : '?'}${queryString}`
}

function buildHeaders(headers: unknown, hasBody: boolean): Record<string, string> {
  const output: Record<string, string> = {}

  if (hasBody) {
    output['Content-Type'] = 'application/json'
  }

  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (typeof value === 'string') output[key] = value
    }
  }

  return output
}

function parseOptionalSchema<S extends ApiSchema | undefined>(
  schema: S,
  value: unknown
): EmptySchemaOutput<S> {
  if (!schema) return undefined as EmptySchemaOutput<S>
  return schema.parse(value) as EmptySchemaOutput<S>
}

async function readResponseBody(response: Response): Promise<{ parsed: unknown; raw?: string }> {
  const text = await response.text()
  if (!text) return { parsed: undefined }

  try {
    return { parsed: JSON.parse(text) as unknown, raw: text }
  } catch {
    return { parsed: text, raw: text }
  }
}

function messageFromErrorBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    const message = record.message ?? record.error
    if (typeof message === 'string' && message.length > 0) return message
  }

  return fallback
}

function isSchemaValidationError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'issues' in error &&
      Array.isArray((error as { issues?: unknown }).issues)
  )
}

export async function requestJson<C extends AnyApiRouteContract>(
  contract: C,
  input: ApiClientRequest<C>
): Promise<ContractJsonResponse<C>> {
  if (contract.response.mode !== 'json') {
    throw new Error(`Contract ${contract.method} ${contract.path} does not declare a JSON response`)
  }

  const parsedParams = parseOptionalSchema(contract.params, input.params)
  const parsedQuery = parseOptionalSchema(contract.query, input.query)
  const parsedBody = parseOptionalSchema(contract.body, input.body)
  const parsedHeaders = parseOptionalSchema(contract.headers, input.headers)

  const url = appendQuery(replacePathParams(contract.path, parsedParams), parsedQuery)
  const hasBody = parsedBody !== undefined && contract.method !== 'GET'

  const response = await fetch(url, {
    method: contract.method,
    headers: buildHeaders(parsedHeaders, hasBody),
    body: hasBody ? JSON.stringify(parsedBody) : undefined,
    signal: input.signal,
  })

  const { parsed, raw } = await readResponseBody(response)
  if (!response.ok) {
    throw new ApiClientError({
      status: response.status,
      message: messageFromErrorBody(parsed, `Request failed with ${response.status}`),
      body: parsed,
      rawBody: raw,
    })
  }

  try {
    return contract.response.schema.parse(parsed) as ContractJsonResponse<C>
  } catch (error) {
    if (isSchemaValidationError(error)) {
      throw new ApiClientError({
        status: response.status,
        message: 'Response failed contract validation',
        body: parsed,
        rawBody: raw,
      })
    }
    throw error
  }
}

export async function requestRaw<C extends AnyApiRouteContract>(
  contract: C,
  input: ApiClientRequest<C>,
  options: ApiRawRequestOptions = {}
): Promise<Response> {
  const parsedParams = parseOptionalSchema(contract.params, input.params)
  const parsedQuery = parseOptionalSchema(contract.query, input.query)
  const parsedBody = parseOptionalSchema(contract.body, input.body)
  const parsedHeaders = parseOptionalSchema(contract.headers, input.headers)

  const url = appendQuery(replacePathParams(contract.path, parsedParams), parsedQuery)
  const hasBody = parsedBody !== undefined && contract.method !== 'GET'
  const headers = {
    ...buildHeaders(parsedHeaders, hasBody),
    ...options.headers,
  }

  const response = await fetch(url, {
    method: contract.method,
    headers,
    body: hasBody ? JSON.stringify(parsedBody) : undefined,
    signal: input.signal,
    cache: options.cache,
  })

  if (!response.ok) {
    const { parsed, raw } = await readResponseBody(response)
    throw new ApiClientError({
      status: response.status,
      message: messageFromErrorBody(parsed, `Request failed with ${response.status}`),
      body: parsed,
      rawBody: raw,
    })
  }

  return response
}
