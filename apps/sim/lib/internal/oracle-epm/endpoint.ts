import { DEFAULT_MAX_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import { getOracleEpmRouteSpace } from '@/lib/internal/oracle-epm/route-space'
import type {
  OracleEpmEndpoint,
  OracleEpmEndpointDeclaration,
  OracleEpmHeaderDeclaration,
  OracleEpmPathPart,
  OracleEpmQueryParameter,
  OracleEpmRouteSpace,
} from '@/lib/internal/oracle-epm/types'

const MAX_DECLARATION_ENTRIES = 32
const MAX_LITERAL_BYTES = 255
const FORBIDDEN_HEADERS = new Set([
  'accept',
  'authorization',
  'connection',
  'content-length',
  'cookie',
  'host',
  'proxy-authorization',
  'set-cookie',
  'transfer-encoding',
])
const FORBIDDEN_CORRELATION_HEADERS = new Set([
  ...FORBIDDEN_HEADERS,
  'authentication-info',
  'proxy-authenticate',
  'proxy-authentication-info',
  'www-authenticate',
])
const TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const endpoints = new WeakMap<object, OracleEpmEndpointDefinition>()

/** Internal frozen endpoint metadata available only after runtime-brand validation. */
export interface OracleEpmEndpointDefinition extends OracleEpmEndpointDeclaration {
  readonly routeSpace: OracleEpmRouteSpace
}

function validatePattern(pattern: RegExp | undefined, label: string): void {
  if (pattern && (pattern.global || pattern.sticky)) {
    throw new Error(`${label} pattern cannot use global or sticky flags`)
  }
}

function validatePath(path: readonly OracleEpmPathPart[]): void {
  if (!Array.isArray(path) || path.length > MAX_DECLARATION_ENTRIES) {
    throw new Error('Oracle EPM endpoint path is invalid')
  }
  const names = new Set<string>()
  for (const part of path) {
    if (part.kind === 'literal') {
      if (
        !part.value ||
        part.value === '.' ||
        part.value === '..' ||
        /[/\\\u0000-\u001f\u007f\uD800-\uDFFF]/.test(part.value) ||
        Buffer.byteLength(part.value, 'utf8') > MAX_LITERAL_BYTES
      ) {
        throw new Error('Oracle EPM endpoint literal path segment is invalid')
      }
      continue
    }
    if (
      part.kind !== 'parameter' ||
      !TOKEN.test(part.name) ||
      names.has(part.name) ||
      !Number.isInteger(part.maxBytes) ||
      part.maxBytes < 1 ||
      part.maxBytes > MAX_LITERAL_BYTES
    ) {
      throw new Error('Oracle EPM endpoint path parameter declaration is invalid')
    }
    validatePattern(part.pattern, `Oracle EPM path parameter ${part.name}`)
    names.add(part.name)
  }
}

function validateQuery(query: Readonly<Record<string, OracleEpmQueryParameter>> = {}): void {
  const entries = Object.entries(query)
  if (entries.length > MAX_DECLARATION_ENTRIES)
    throw new Error('Too many Oracle EPM query parameters')
  for (const [name, declaration] of entries) {
    if (!TOKEN.test(name)) throw new Error('Oracle EPM query parameter name is invalid')
    if (declaration.kind === 'string') {
      if (
        !Number.isInteger(declaration.maxBytes) ||
        declaration.maxBytes < 1 ||
        declaration.maxBytes > 4_096
      ) {
        throw new Error(`Oracle EPM query parameter ${name} has an invalid limit`)
      }
      validatePattern(declaration.pattern, `Oracle EPM query parameter ${name}`)
    } else if (declaration.kind === 'integer') {
      if (
        !Number.isSafeInteger(declaration.minimum) ||
        !Number.isSafeInteger(declaration.maximum) ||
        declaration.minimum > declaration.maximum
      ) {
        throw new Error(`Oracle EPM query parameter ${name} has invalid integer bounds`)
      }
    } else if (declaration.kind !== 'boolean') {
      throw new Error(`Oracle EPM query parameter ${name} has an invalid type`)
    }
  }
}

function validateHeaders(headers: Readonly<Record<string, OracleEpmHeaderDeclaration>> = {}): void {
  const entries = Object.entries(headers)
  if (entries.length > MAX_DECLARATION_ENTRIES) throw new Error('Too many Oracle EPM headers')
  const wireNames = new Set<string>()
  for (const [inputName, declaration] of entries) {
    const wireName = declaration.name.toLowerCase()
    if (
      !TOKEN.test(inputName) ||
      !/^[A-Za-z0-9-]+$/.test(declaration.name) ||
      wireNames.has(wireName) ||
      FORBIDDEN_HEADERS.has(wireName)
    ) {
      throw new Error('Oracle EPM header declaration is invalid')
    }
    if (
      !Number.isInteger(declaration.maxBytes) ||
      declaration.maxBytes < 1 ||
      declaration.maxBytes > 8_192
    ) {
      throw new Error(`Oracle EPM header ${inputName} has an invalid limit`)
    }
    validatePattern(declaration.pattern, `Oracle EPM header ${inputName}`)
    wireNames.add(wireName)
  }
}

function clonePattern(pattern: RegExp | undefined): RegExp | undefined {
  return pattern ? new RegExp(pattern.source, pattern.flags) : undefined
}

function freezeDeclaration(
  declaration: OracleEpmEndpointDeclaration
): OracleEpmEndpointDeclaration {
  const path = declaration.path.map((part) =>
    Object.freeze(
      part.kind === 'parameter' ? { ...part, pattern: clonePattern(part.pattern) } : { ...part }
    )
  )
  const query = Object.fromEntries(
    Object.entries(declaration.query ?? {}).map(([name, value]) => [
      name,
      Object.freeze(
        value.kind === 'string' ? { ...value, pattern: clonePattern(value.pattern) } : { ...value }
      ),
    ])
  )
  const headers = Object.fromEntries(
    Object.entries(declaration.headers ?? {}).map(([name, value]) => [
      name,
      Object.freeze({ ...value, pattern: clonePattern(value.pattern) }),
    ])
  )
  const errors = declaration.errors
    ? Object.freeze({
        ...declaration.errors,
        providerCodePath: Object.freeze([...(declaration.errors.providerCodePath ?? [])]),
        allowedProviderCodes: Object.freeze([...(declaration.errors.allowedProviderCodes ?? [])]),
        correlationHeaders: Object.freeze([...(declaration.errors.correlationHeaders ?? [])]),
      })
    : undefined
  const retry = declaration.retry
    ? Object.freeze({
        ...declaration.retry,
        statuses: Object.freeze([...declaration.retry.statuses]),
      })
    : undefined
  return Object.freeze({
    ...declaration,
    path: Object.freeze(path),
    query: Object.freeze(query),
    headers: Object.freeze(headers),
    errors,
    retry,
  })
}

/** Defines a literal path segment that can never be replaced by tool input. */
export function oracleEpmLiteral(value: string): OracleEpmPathPart {
  return Object.freeze({ kind: 'literal', value })
}

/** Defines one individually encoded path parameter. */
export function oracleEpmPathParameter(
  name: string,
  options: { maxBytes: number; pattern?: RegExp }
): OracleEpmPathPart {
  return Object.freeze({ kind: 'parameter', name, ...options })
}

/** Creates a branded endpoint after validating its complete static declaration. */
export function defineOracleEpmEndpoint(
  routeSpace: OracleEpmRouteSpace,
  declaration: OracleEpmEndpointDeclaration
): OracleEpmEndpoint {
  const route = getOracleEpmRouteSpace(routeSpace)
  if (!route.allowedVersions.includes(declaration.version))
    throw new Error('Oracle EPM endpoint version is not declared by its route space')
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(declaration.method))
    throw new Error('Oracle EPM endpoint method is invalid')
  validatePath(declaration.path)
  validateQuery(declaration.query)
  validateHeaders(declaration.headers)
  if (
    !['none', 'json', 'stream'].includes(declaration.body) ||
    !['empty', 'json', 'stream'].includes(declaration.response)
  ) {
    throw new Error('Oracle EPM endpoint body or response mode is invalid')
  }
  if (
    !Number.isInteger(declaration.timeoutMs) ||
    declaration.timeoutMs < 100 ||
    declaration.timeoutMs > 300_000
  )
    throw new Error('Oracle EPM endpoint timeout is invalid')
  if (
    !Number.isInteger(declaration.maxResponseBytes) ||
    declaration.maxResponseBytes < 1 ||
    declaration.maxResponseBytes > DEFAULT_MAX_RESPONSE_BYTES
  ) {
    throw new Error('Oracle EPM endpoint response limit is invalid')
  }
  if (
    (declaration.body === 'none' && declaration.maxRequestBytes !== undefined) ||
    (declaration.body !== 'none' &&
      (!Number.isInteger(declaration.maxRequestBytes) ||
        (declaration.maxRequestBytes ?? 0) < 1 ||
        (declaration.maxRequestBytes ?? 0) > DEFAULT_MAX_RESPONSE_BYTES))
  ) {
    throw new Error('Oracle EPM endpoint request limit is invalid')
  }
  if (declaration.retry) {
    const { maxAttempts, statuses, initialDelayMs, maxDelayMs } = declaration.retry
    if (
      declaration.method !== 'GET' ||
      !Number.isInteger(maxAttempts) ||
      maxAttempts < 1 ||
      maxAttempts > 2 ||
      !statuses.length ||
      statuses.some((status) => !Number.isInteger(status) || status < 400 || status > 599) ||
      !Number.isInteger(initialDelayMs) ||
      !Number.isInteger(maxDelayMs) ||
      initialDelayMs < 0 ||
      maxDelayMs < initialDelayMs ||
      maxDelayMs > 30_000
    ) {
      throw new Error('Oracle EPM endpoint retry policy is invalid')
    }
  }
  const allowedProviderCodes = declaration.errors?.allowedProviderCodes ?? []
  const correlationHeaders = declaration.errors?.correlationHeaders ?? []
  if (
    declaration.errors?.providerCodePath?.some((part) => !TOKEN.test(part)) ||
    allowedProviderCodes.some((code) => !code || code.length > 128) ||
    new Set(allowedProviderCodes).size !== allowedProviderCodes.length ||
    correlationHeaders.some(
      (name) =>
        !/^[A-Za-z0-9-]+$/.test(name) || FORBIDDEN_CORRELATION_HEADERS.has(name.toLowerCase())
    ) ||
    new Set(correlationHeaders.map((name) => name.toLowerCase())).size !== correlationHeaders.length
  ) {
    throw new Error('Oracle EPM endpoint error policy is invalid')
  }

  const endpoint = Object.freeze({}) as OracleEpmEndpoint
  endpoints.set(endpoint, Object.freeze({ ...freezeDeclaration(declaration), routeSpace }))
  return endpoint
}

/** Reads an endpoint declaration only after its runtime brand is verified. */
export function getOracleEpmEndpoint(endpoint: OracleEpmEndpoint): OracleEpmEndpointDefinition {
  const definition = endpoints.get(endpoint)
  if (!definition) throw new Error('Oracle EPM endpoint is not a valid declaration')
  return definition
}

/** Factories for bounded scalar query declarations. */
export const oracleEpmQuery = Object.freeze({
  string(options: {
    required?: boolean
    maxBytes: number
    pattern?: RegExp
  }): OracleEpmQueryParameter {
    return Object.freeze({ kind: 'string', ...options })
  },
  integer(options: {
    required?: boolean
    minimum: number
    maximum: number
  }): OracleEpmQueryParameter {
    return Object.freeze({ kind: 'integer', ...options })
  },
  boolean(options: { required?: boolean } = {}): OracleEpmQueryParameter {
    return Object.freeze({ kind: 'boolean', ...options })
  },
})
