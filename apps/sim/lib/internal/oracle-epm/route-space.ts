import { defineOracleEpmEndpoint } from '@/lib/internal/oracle-epm/endpoint'
import { defineOracleEpmReturnedLinkPolicy } from '@/lib/internal/oracle-epm/links'
import type {
  OracleEpmEndpointDeclaration,
  OracleEpmReturnedLinkPolicy,
  OracleEpmReturnedLinkPolicyDeclaration,
  OracleEpmRouteSpace,
} from '@/lib/internal/oracle-epm/types'

const MAX_CONTEXT_SEGMENTS = 16
const MAX_SEGMENT_BYTES = 255
const STATIC_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/
const routeSpaces = new WeakMap<object, OracleEpmRouteSpaceDefinition>()

/** Internal frozen route metadata available only after runtime-brand validation. */
export interface OracleEpmRouteSpaceDefinition {
  readonly context: readonly string[]
  readonly allowedVersions: readonly string[]
}

function validateStaticSegments(values: readonly string[], label: string): void {
  if (!Array.isArray(values) || !values.length || values.length > MAX_CONTEXT_SEGMENTS) {
    throw new Error(`${label} declaration is invalid`)
  }
  const seen = new Set<string>()
  for (const value of values) {
    if (
      typeof value !== 'string' ||
      !STATIC_SEGMENT.test(value) ||
      value === '.' ||
      value === '..' ||
      Buffer.byteLength(value, 'utf8') > MAX_SEGMENT_BYTES ||
      seen.has(value)
    ) {
      throw new Error(`${label} declaration is invalid`)
    }
    seen.add(value)
  }
}

/**
 * Defines a child-owned Oracle EPM context and its exact, case-sensitive API
 * versions. Declarations are static code and are validated immediately.
 */
export function defineOracleEpmRouteSpace(declaration: {
  readonly context: readonly string[]
  readonly allowedVersions: readonly string[]
}): OracleEpmRouteSpace {
  validateStaticSegments(declaration.context, 'Oracle EPM route context')
  validateStaticSegments(declaration.allowedVersions, 'Oracle EPM route version')
  const context = Object.freeze([...declaration.context])
  const allowedVersions = Object.freeze([...declaration.allowedVersions])
  const routeSpace = Object.freeze({
    context,
    allowedVersions,
    defineEndpoint: (endpointDeclaration: OracleEpmEndpointDeclaration) =>
      defineOracleEpmEndpoint(routeSpace, endpointDeclaration),
    defineReturnedLinkPolicy: (
      policyDeclaration: OracleEpmReturnedLinkPolicyDeclaration
    ): OracleEpmReturnedLinkPolicy =>
      defineOracleEpmReturnedLinkPolicy(routeSpace, policyDeclaration),
  }) as OracleEpmRouteSpace
  routeSpaces.set(routeSpace, Object.freeze({ context, allowedVersions }))
  return routeSpace
}

/** Reads a route-space declaration only after its runtime brand is verified. */
export function getOracleEpmRouteSpace(
  routeSpace: OracleEpmRouteSpace
): OracleEpmRouteSpaceDefinition {
  const definition = routeSpaces.get(routeSpace)
  if (!definition) throw new Error('Oracle EPM route space is not a valid declaration')
  return definition
}
