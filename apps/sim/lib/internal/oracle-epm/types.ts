import type { HttpMethod } from '@/tools/types'

declare const destinationBrand: unique symbol
declare const routeSpaceBrand: unique symbol
declare const endpointBrand: unique symbol
declare const linkPolicyBrand: unique symbol
declare const validatedLinkBrand: unique symbol

/** A validated HTTPS environment URL supplied by one credential. */
export interface OracleEpmDestination {
  readonly [destinationBrand]: true
}

/** One static or individually encoded segment in a declared endpoint path. */
export type OracleEpmPathPart =
  | { readonly kind: 'literal'; readonly value: string }
  | {
      readonly kind: 'parameter'
      readonly name: string
      readonly maxBytes: number
      readonly pattern?: RegExp
    }

/** Bounded scalar query input admitted by an endpoint or returned-link policy. */
export type OracleEpmQueryParameter =
  | {
      readonly kind: 'string'
      readonly required?: boolean
      readonly maxBytes: number
      readonly pattern?: RegExp
    }
  | {
      readonly kind: 'integer'
      readonly required?: boolean
      readonly minimum: number
      readonly maximum: number
    }
  | { readonly kind: 'boolean'; readonly required?: boolean }

/** Bounded header input whose wire name is fixed by trusted source code. */
export interface OracleEpmHeaderDeclaration {
  readonly name: string
  readonly required?: boolean
  readonly maxBytes: number
  readonly pattern?: RegExp
}

/** Body encodings understood by the guarded client. */
export type OracleEpmBodyMode = 'none' | 'json' | 'stream'
/** Response projections understood by the guarded client. */
export type OracleEpmResponseMode = 'empty' | 'json' | 'stream'

/** Declarative allowlist for safe provider error metadata. */
export interface OracleEpmErrorPolicyDeclaration {
  /** Static JSON property path containing a documented provider error code. */
  readonly providerCodePath?: readonly string[]
  /** Exact provider codes safe to expose outside the transport. */
  readonly allowedProviderCodes?: readonly string[]
  /** Response headers that may carry a non-secret request/correlation id. */
  readonly correlationHeaders?: readonly string[]
}

/** Complete static transport contract owned by one product child. */
export interface OracleEpmEndpointDeclaration {
  readonly method: HttpMethod
  readonly version: string
  readonly path: readonly OracleEpmPathPart[]
  readonly query?: Readonly<Record<string, OracleEpmQueryParameter>>
  readonly headers?: Readonly<Record<string, OracleEpmHeaderDeclaration>>
  readonly body: OracleEpmBodyMode
  readonly response: OracleEpmResponseMode
  readonly timeoutMs: number
  /** Required for request bodies and forbidden for bodyless endpoints. */
  readonly maxRequestBytes?: number
  readonly maxResponseBytes: number
  readonly retry?: {
    readonly maxAttempts: number
    readonly statuses: readonly number[]
    readonly initialDelayMs: number
    readonly maxDelayMs: number
  }
  readonly errors?: OracleEpmErrorPolicyDeclaration
}

/** A child-owned, validated and immutable Oracle EPM route declaration. */
export interface OracleEpmRouteSpace {
  readonly [routeSpaceBrand]: true
  readonly context: readonly string[]
  readonly allowedVersions: readonly string[]
  defineEndpoint(declaration: OracleEpmEndpointDeclaration): OracleEpmEndpoint
  defineReturnedLinkPolicy(
    declaration: OracleEpmReturnedLinkPolicyDeclaration
  ): OracleEpmReturnedLinkPolicy
}

/** A fully static request contract created from a route space. */
export interface OracleEpmEndpoint {
  readonly [endpointBrand]: true
}

/** Static route, method, relation, and response rules for one returned link. */
export interface OracleEpmReturnedLinkPolicyDeclaration {
  readonly relation: string
  readonly method: HttpMethod
  /** Bind to this endpoint, or use route/version/path below. */
  readonly endpoint?: OracleEpmEndpoint
  readonly version?: string
  readonly path?: readonly OracleEpmPathPart[]
  readonly query?: Readonly<Record<string, OracleEpmQueryParameter>>
  /** Required for route-bound policies and inherited by endpoint-bound policies. */
  readonly response?: OracleEpmResponseMode
  readonly timeoutMs?: number
  readonly maxResponseBytes?: number
  readonly errors?: OracleEpmErrorPolicyDeclaration
  readonly preserveGatewayBasePath: boolean
}

/** A reviewed, declarative contract for one provider-returned link. */
export interface OracleEpmReturnedLinkPolicy {
  readonly [linkPolicyBrand]: true
}

/** An opaque capability. Only the client that validated it can consume it. */
export interface OracleEpmValidatedLink {
  readonly [validatedLinkBrand]: true
}

/** Dynamic values accepted by a previously declared endpoint. */
export interface OracleEpmRequestInput {
  readonly pathParams?: Readonly<Record<string, string>>
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>
  readonly headers?: Readonly<Record<string, string | undefined>>
  readonly json?: unknown
  readonly stream?: Uint8Array
  readonly signal?: AbortSignal
}

/** Sanitized successful JSON response. */
export interface OracleEpmJsonResponse {
  readonly status: number
  readonly data: unknown
  readonly correlationId?: string
}

/** Sanitized successful bodyless response. */
export interface OracleEpmEmptyResponse {
  readonly status: number
  readonly correlationId?: string
}

/** Bounded response stream with only safe, explicitly projected metadata. */
export interface OracleEpmStreamResponse {
  readonly status: number
  readonly body: ReadableStream<Uint8Array>
  readonly contentLength?: number
  readonly contentType?: string
  readonly correlationId?: string
}

/** Successful response projections returned by the guarded client. */
export type OracleEpmClientResponse =
  | OracleEpmJsonResponse
  | OracleEpmEmptyResponse
  | OracleEpmStreamResponse
