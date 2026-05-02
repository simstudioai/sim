import type { z } from 'zod'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type ApiSchema = z.ZodType

export type EmptySchemaOutput<S extends ApiSchema | undefined> = S extends ApiSchema
  ? z.output<S>
  : undefined

export type EmptySchemaInput<S extends ApiSchema | undefined> = S extends ApiSchema
  ? z.input<S>
  : undefined

export type JsonResponseMode<S extends ApiSchema = ApiSchema> = {
  mode: 'json'
  schema: S
  status?: number | readonly number[]
}

export type EmptyResponseMode = {
  mode: 'empty'
  status?: number | readonly number[]
}

export type TextResponseMode = {
  mode: 'text'
  status?: number | readonly number[]
}

export type BinaryResponseMode = {
  mode: 'binary'
  status?: number | readonly number[]
}

export type StreamResponseMode = {
  mode: 'stream'
  status?: number | readonly number[]
}

export type RedirectResponseMode = {
  mode: 'redirect'
  status?: number | readonly number[]
}

export type ResponseMode<S extends ApiSchema = ApiSchema> =
  | JsonResponseMode<S>
  | EmptyResponseMode
  | TextResponseMode
  | BinaryResponseMode
  | StreamResponseMode
  | RedirectResponseMode

export interface ApiRouteContract<
  TParams extends ApiSchema | undefined = undefined,
  TQuery extends ApiSchema | undefined = undefined,
  TBody extends ApiSchema | undefined = undefined,
  THeaders extends ApiSchema | undefined = undefined,
  TResponse extends ResponseMode = ResponseMode,
  TError extends ApiSchema | undefined = undefined,
> {
  method: HttpMethod
  path: string
  params?: TParams
  query?: TQuery
  body?: TBody
  headers?: THeaders
  response: TResponse
  error?: TError
}

export type AnyApiRouteContract = ApiRouteContract<
  ApiSchema | undefined,
  ApiSchema | undefined,
  ApiSchema | undefined,
  ApiSchema | undefined,
  ResponseMode,
  ApiSchema | undefined
>

export function defineRouteContract<
  TParams extends ApiSchema | undefined = undefined,
  TQuery extends ApiSchema | undefined = undefined,
  TBody extends ApiSchema | undefined = undefined,
  THeaders extends ApiSchema | undefined = undefined,
  TResponse extends ResponseMode = ResponseMode,
  TError extends ApiSchema | undefined = undefined,
>(
  contract: ApiRouteContract<TParams, TQuery, TBody, THeaders, TResponse, TError>
): ApiRouteContract<TParams, TQuery, TBody, THeaders, TResponse, TError> {
  return contract
}

export type ContractParams<C extends AnyApiRouteContract> = C extends ApiRouteContract<
  infer TParams,
  ApiSchema | undefined,
  ApiSchema | undefined,
  ApiSchema | undefined,
  ResponseMode,
  ApiSchema | undefined
>
  ? EmptySchemaOutput<TParams>
  : undefined
export type ContractQuery<C extends AnyApiRouteContract> = C extends ApiRouteContract<
  ApiSchema | undefined,
  infer TQuery,
  ApiSchema | undefined,
  ApiSchema | undefined,
  ResponseMode,
  ApiSchema | undefined
>
  ? EmptySchemaOutput<TQuery>
  : undefined
export type ContractBody<C extends AnyApiRouteContract> = C extends ApiRouteContract<
  ApiSchema | undefined,
  ApiSchema | undefined,
  infer TBody,
  ApiSchema | undefined,
  ResponseMode,
  ApiSchema | undefined
>
  ? EmptySchemaOutput<TBody>
  : undefined
export type ContractHeaders<C extends AnyApiRouteContract> = C extends ApiRouteContract<
  ApiSchema | undefined,
  ApiSchema | undefined,
  ApiSchema | undefined,
  infer THeaders,
  ResponseMode,
  ApiSchema | undefined
>
  ? EmptySchemaOutput<THeaders>
  : undefined

export type ContractParamsInput<C extends AnyApiRouteContract> = C extends ApiRouteContract<
  infer TParams,
  ApiSchema | undefined,
  ApiSchema | undefined,
  ApiSchema | undefined,
  ResponseMode,
  ApiSchema | undefined
>
  ? EmptySchemaInput<TParams>
  : undefined
export type ContractQueryInput<C extends AnyApiRouteContract> = C extends ApiRouteContract<
  ApiSchema | undefined,
  infer TQuery,
  ApiSchema | undefined,
  ApiSchema | undefined,
  ResponseMode,
  ApiSchema | undefined
>
  ? EmptySchemaInput<TQuery>
  : undefined
export type ContractBodyInput<C extends AnyApiRouteContract> = C extends ApiRouteContract<
  ApiSchema | undefined,
  ApiSchema | undefined,
  infer TBody,
  ApiSchema | undefined,
  ResponseMode,
  ApiSchema | undefined
>
  ? EmptySchemaInput<TBody>
  : undefined
export type ContractHeadersInput<C extends AnyApiRouteContract> = C extends ApiRouteContract<
  ApiSchema | undefined,
  ApiSchema | undefined,
  ApiSchema | undefined,
  infer THeaders,
  ResponseMode,
  ApiSchema | undefined
>
  ? EmptySchemaInput<THeaders>
  : undefined

export type ContractJsonResponse<C extends AnyApiRouteContract> =
  C['response'] extends JsonResponseMode<infer S> ? z.output<S> : never
