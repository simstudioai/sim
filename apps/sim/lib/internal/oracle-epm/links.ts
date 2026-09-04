import {
  getOracleEpmEndpoint,
  type OracleEpmEndpointDefinition,
} from '@/lib/internal/oracle-epm/endpoint'
import { getOracleEpmRouteSpace } from '@/lib/internal/oracle-epm/route-space'
import type {
  OracleEpmPathPart,
  OracleEpmQueryParameter,
  OracleEpmReturnedLinkPolicy,
  OracleEpmReturnedLinkPolicyDeclaration,
  OracleEpmRouteSpace,
} from '@/lib/internal/oracle-epm/types'

const policies = new WeakMap<object, OracleEpmReturnedLinkPolicyDefinition>()
const RELATION = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/

/** Internal frozen link policy available only after runtime-brand validation. */
export interface OracleEpmReturnedLinkPolicyDefinition {
  readonly routeSpace: OracleEpmRouteSpace
  readonly relation: string
  readonly method: OracleEpmReturnedLinkPolicyDeclaration['method']
  readonly version: string
  readonly path: readonly OracleEpmPathPart[]
  readonly query: Readonly<Record<string, OracleEpmQueryParameter>>
  readonly preserveGatewayBasePath: boolean
  readonly endpoint: OracleEpmEndpointDefinition
}

/** Creates a declarative, immutable returned-link policy during module initialization. */
export function defineOracleEpmReturnedLinkPolicy(
  routeSpace: OracleEpmRouteSpace,
  declaration: OracleEpmReturnedLinkPolicyDeclaration
): OracleEpmReturnedLinkPolicy {
  const route = getOracleEpmRouteSpace(routeSpace)
  if (!RELATION.test(declaration.relation))
    throw new Error('Oracle EPM returned-link relation is invalid')
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(declaration.method))
    throw new Error('Oracle EPM returned-link method is invalid')

  let version: string
  let path: readonly OracleEpmPathPart[]
  let query: Readonly<Record<string, OracleEpmQueryParameter>>
  let endpointDefinition: OracleEpmEndpointDefinition
  if (declaration.endpoint) {
    if (
      declaration.version ||
      declaration.path ||
      declaration.query ||
      declaration.response ||
      declaration.timeoutMs ||
      declaration.maxResponseBytes ||
      declaration.errors
    ) {
      throw new Error('Endpoint-bound Oracle EPM link policies cannot override route structure')
    }
    const endpoint = getOracleEpmEndpoint(declaration.endpoint)
    if (
      endpoint.routeSpace !== routeSpace ||
      endpoint.method !== declaration.method ||
      endpoint.body !== 'none' ||
      Object.values(endpoint.headers ?? {}).some((header) => header.required)
    ) {
      throw new Error(
        'Oracle EPM returned-link policy endpoint does not match its route, method, or input contract'
      )
    }
    endpointDefinition = endpoint
    version = endpoint.version
    path = endpoint.path
    query = endpoint.query ?? {}
  } else {
    if (
      !declaration.version ||
      !declaration.path ||
      !declaration.response ||
      declaration.timeoutMs === undefined ||
      declaration.maxResponseBytes === undefined
    ) {
      throw new Error(
        'Route-bound Oracle EPM link policies require route and response declarations'
      )
    }
    // Reuse the endpoint validator without retaining the synthetic endpoint.
    const synthetic = routeSpace.defineEndpoint({
      method: declaration.method,
      version: declaration.version,
      path: declaration.path,
      query: declaration.query,
      body: 'none',
      response: declaration.response,
      timeoutMs: declaration.timeoutMs,
      maxResponseBytes: declaration.maxResponseBytes,
      errors: declaration.errors,
    })
    const endpoint = getOracleEpmEndpoint(synthetic)
    endpointDefinition = endpoint
    version = endpoint.version
    path = endpoint.path
    query = endpoint.query ?? {}
  }
  if (!route.allowedVersions.includes(version))
    throw new Error('Oracle EPM returned-link version is not declared')

  const policy = Object.freeze({}) as OracleEpmReturnedLinkPolicy
  policies.set(
    policy,
    Object.freeze({
      routeSpace,
      relation: declaration.relation,
      method: declaration.method,
      version,
      path,
      query,
      preserveGatewayBasePath: declaration.preserveGatewayBasePath,
      endpoint: endpointDefinition,
    })
  )
  return policy
}

/** Reads a link policy only after its runtime brand is verified. */
export function getOracleEpmReturnedLinkPolicy(
  policy: OracleEpmReturnedLinkPolicy
): OracleEpmReturnedLinkPolicyDefinition {
  const definition = policies.get(policy)
  if (!definition) throw new Error('Oracle EPM returned-link policy is not a valid declaration')
  return definition
}
