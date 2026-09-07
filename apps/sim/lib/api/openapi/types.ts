import type { z } from 'zod'
import type { AnyApiRouteContract, ApiSchema, JsonResponseMode } from '@/lib/api/contracts/types'
import type { ApplicationOperation } from '@/lib/core/application/operation'

export type OpenApiSecurityRequirement = Readonly<Record<string, readonly string[]>>

export type OpenApiSecurityScheme =
  | {
      type: 'apiKey'
      in: 'header' | 'query' | 'cookie'
      name: string
      description: string
    }
  | {
      type: 'http'
      scheme: string
      bearerFormat?: string
      description: string
    }

export interface OpenApiInfo {
  title: string
  description: string
  version: string
  contact?: {
    name: string
    email?: string
    url?: string
  }
  license?: {
    name: string
    url?: string
  }
}

export interface OpenApiServer {
  url: string
  description: string
}

export interface OpenApiTag {
  name: string
  description: string
}

export interface OpenApiHeader {
  schema: ApiSchema
}

export interface OpenApiErrorResponse {
  status: number
  description: string
  headers?: readonly string[]
  /**
   * The body this status is documented with, validated against the document's `errorSchema`
   * at generation time.
   *
   * Required, because the alternative is what every status rendered before it existed: the
   * error schema's single shared example, so the reference answered `400 BAD_REQUEST` under
   * the `401`, `404`, and `500` tabs alike. A reference that confidently shows the wrong
   * body is worse than one that shows none.
   *
   * The document's own layer assembles it — only that layer knows how its codes pair with
   * statuses — and this generator checks it parses.
   */
  example: unknown
}

export interface OpenApiSuccessMetadata {
  description: string
  headers?: readonly string[]
  contentTypes?: readonly [string, ...string[]]
}

export interface OpenApiStatusSuccessMetadata {
  description: string
  headers?: readonly string[]
  additionalContentTypes?: readonly [string, ...string[]]
}

export type OpenApiOperationSuccess =
  | OpenApiSuccessMetadata
  | {
      byStatus: Readonly<Record<number, OpenApiStatusSuccessMetadata>>
    }

export interface OpenApiOperationMetadata {
  /** Canonical policy shared with every adapter for this application operation. */
  applicationOperation: Pick<ApplicationOperation, 'id' | 'oauthScope'>
  operationId: string
  summary: string
  description: string
  tags: readonly [string, ...string[]]
  errors: readonly string[]
  success: OpenApiOperationSuccess
  deprecated?: boolean
  security?: readonly OpenApiSecurityRequirement[]
}

type PresentSchema<Key extends string, Schema> = Schema extends ApiSchema
  ? { [K in Key]: Schema }
  : { [K in Key]?: never }

type DocumentedResponseSchema<C extends AnyApiRouteContract> =
  C['response'] extends JsonResponseMode<infer Schema> ? { response: Schema } : { response?: never }

export interface OpenApiRequestBodySchema {
  schema: ApiSchema
  contentTypes: readonly [string, ...string[]]
}

type DocumentedRequestBodySchema<C extends AnyApiRouteContract> = C['body'] extends ApiSchema
  ? { requestBody?: never }
  : { requestBody?: OpenApiRequestBodySchema }

type DocumentedStatusResponseSchemas<C extends AnyApiRouteContract> =
  C['response'] extends JsonResponseMode & {
    statusSchemas: infer Schemas extends Readonly<Record<number, ApiSchema>>
  }
    ? { responses: Schemas }
    : { responses?: never }

export type OpenApiDocumentedSchemas<C extends AnyApiRouteContract> = PresentSchema<
  'params',
  C['params']
> &
  PresentSchema<'query', C['query']> &
  PresentSchema<'body', C['body']> &
  DocumentedRequestBodySchema<C> &
  PresentSchema<'headers', C['headers']> &
  DocumentedResponseSchema<C> &
  DocumentedStatusResponseSchemas<C>

export interface OpenApiRouteDefinition<C extends AnyApiRouteContract = AnyApiRouteContract> {
  contract: C
  operation: OpenApiOperationMetadata
  schemas: OpenApiDocumentedSchemas<C>
}

export interface OpenApiDocumentDefinition {
  output: string
  info: OpenApiInfo
  servers: readonly OpenApiServer[]
  tags: readonly OpenApiTag[]
  security: readonly OpenApiSecurityRequirement[]
  securitySchemes: Readonly<Record<string, OpenApiSecurityScheme>>
  headers: Readonly<Record<string, OpenApiHeader>>
  errorSchema: z.ZodType
  errorResponses: Readonly<Record<string, OpenApiErrorResponse>>
  routes: readonly OpenApiRouteDefinition[]
}

export function defineOpenApiRoute<C extends AnyApiRouteContract>(
  contract: C,
  operation: OpenApiOperationMetadata,
  schemas: OpenApiDocumentedSchemas<C>
): OpenApiRouteDefinition<C> {
  return { contract, operation, schemas }
}

export function defineOpenApiDocument(
  definition: OpenApiDocumentDefinition
): OpenApiDocumentDefinition {
  return definition
}
