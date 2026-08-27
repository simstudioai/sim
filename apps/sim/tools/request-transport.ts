import { isDeepStrictEqual } from 'node:util'
import { isPlainRecord } from '@sim/utils/object'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import type { HttpRedirectPolicy } from '@/lib/core/security/http-redirect-policy'
import {
  addModelInputProvenanceToRequest,
  createModelInputProvenanceRequestMetadata,
  createPrivateSecretProvenanceRequestMetadata,
  markModelInputProjected,
} from '@/lib/execution/model-input-provenance'
import { refuseResolvedSecretProjection } from '@/executor/utils/resolved-secret-projection-refusal'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { ToolConfig } from '@/tools/types'

const MODEL_INPUT_PROJECTION_ERROR_MESSAGE = 'Model input could not be safely projected'
const PRIVATE_MODEL_INPUT_EXTERNAL_URL_ERROR_MESSAGE =
  'Private model input provenance is only supported for internal routes'
const PRIVATE_SECRET_PROVENANCE_EXTERNAL_URL_ERROR_MESSAGE =
  'Private secret provenance is only supported for internal routes'
const EXTERNAL_REQUEST_URL_ERROR_MESSAGE = 'External tool requests require an absolute HTTP(S) URL'
const INTERNAL_REQUEST_URL_ERROR_MESSAGE = 'Internal tool requests must target a Sim API route'
const INTERNAL_REQUEST_BASE_URL = 'http://sim.internal'

export interface PreparedToolRequest {
  url: string
  method: string
  headers: Headers
  body?: string
  timeout?: number
  proxyUrl?: string
  stripAuthOnRedirect?: boolean
  redirectPolicy?: HttpRedirectPolicy
  isInternalRoute: boolean
}

function haveExactOwnKeys(
  selected: Record<string, unknown>,
  projected: Record<string, unknown>
): boolean {
  const selectedKeys = Reflect.ownKeys(selected)
  const projectedKeys = Reflect.ownKeys(projected)
  return (
    selectedKeys.length === projectedKeys.length &&
    selectedKeys.every((key) => typeof key === 'string' && Object.hasOwn(projected, key)) &&
    projectedKeys.every((key) => typeof key === 'string' && Object.hasOwn(selected, key))
  )
}

export function getOwnEnumerableDataEntries(
  record: Record<string, unknown>
): Array<[string, unknown]> | undefined {
  const entries: Array<[string, unknown]> = []
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== 'string') return undefined
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) return undefined
    entries.push([key, descriptor.value])
  }
  return entries
}

function inspectSelectedModelInputRecord(
  tool: ToolConfig,
  selected: unknown
): { record: Record<string, unknown>; entries: Array<[string, unknown]> } | undefined {
  if (!isPlainRecord(selected)) return undefined

  const entries = getOwnEnumerableDataEntries(selected)
  if (!entries || entries.some(([key]) => !Object.hasOwn(tool.params, key))) return undefined
  return { record: selected, entries }
}

export function projectToolModelInputParams(
  tool: ToolConfig,
  params: Record<string, any>,
  registry: ResolvedSecretTraceRegistry | undefined
): Record<string, any> {
  const modelInput = tool.request.modelInput
  if (!registry || modelInput?.mode !== 'project') return params

  try {
    const selection = inspectSelectedModelInputRecord(tool, modelInput.select(params))
    if (!selection) throw new Error(MODEL_INPUT_PROJECTION_ERROR_MESSAGE)

    const { record: selected, entries } = selection
    const originalSelectedParams: Record<string, unknown> = {}
    for (const [key] of entries) originalSelectedParams[key] = params[key]
    const projection = registry.projectResolvedInputSelection(originalSelectedParams)
    if (!projection.complete) {
      throw new Error(MODEL_INPUT_PROJECTION_ERROR_MESSAGE)
    }

    const projectedParams = { ...params, ...projection.value }
    const projectedSelection = inspectSelectedModelInputRecord(
      tool,
      modelInput.select(projectedParams)
    )
    if (!projectedSelection || !haveExactOwnKeys(selected, projectedSelection.record)) {
      throw new Error(MODEL_INPUT_PROJECTION_ERROR_MESSAGE)
    }
    JSON.stringify(projectedSelection.record)

    if (!modelInput.applyProjected) return projectedParams

    const selectedParamsClone = structuredClone(originalSelectedParams)
    const patch = inspectSelectedModelInputRecord(
      tool,
      modelInput.applyProjected(selectedParamsClone, projectedSelection.record)
    )
    if (!patch || !haveExactOwnKeys(selected, patch.record)) {
      throw new Error(MODEL_INPUT_PROJECTION_ERROR_MESSAGE)
    }

    const patchedParams = { ...projectedParams, ...patch.record }
    const verification = inspectSelectedModelInputRecord(tool, modelInput.select(patchedParams))
    if (
      !verification ||
      !haveExactOwnKeys(selected, verification.record) ||
      !isDeepStrictEqual(verification.record, projectedSelection.record)
    ) {
      throw new Error(MODEL_INPUT_PROJECTION_ERROR_MESSAGE)
    }

    return patchedParams
  } catch {
    refuseResolvedSecretProjection({
      site: 'tools.requestTransportModelInput',
      message: MODEL_INPUT_PROJECTION_ERROR_MESSAGE,
      registry,
    })
  }
}

function collectProvenanceSensitiveHeaders(
  tool: ToolConfig,
  params: Record<string, any>,
  headers: Headers,
  registry: ResolvedSecretTraceRegistry | undefined
): string[] {
  if (!registry) return []
  const projections = registry.projectResolvedInputSelections(params)
  if (!projections.complete) return []

  const sensitiveHeaders = new Set<string>()
  for (const projection of projections.values) {
    let projectedHeaders: Headers
    try {
      projectedHeaders = new Headers(tool.request.headers(projection.value))
    } catch {
      continue
    }
    headers.forEach((value, name) => {
      if (projectedHeaders.get(name) !== value) sensitiveHeaders.add(name)
    })
  }
  return [...sensitiveHeaders]
}

function formatToolRequest(
  tool: ToolConfig,
  params: Record<string, any>,
  registry: ResolvedSecretTraceRegistry | undefined,
  isInternalRoute: boolean
): PreparedToolRequest {
  const url = typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url
  assertRequestUrlMatchesTrust(url, isInternalRoute)
  const method =
    typeof tool.request.method === 'function'
      ? tool.request.method(params)
      : params.method || tool.request.method || 'GET'
  const headers = new Headers(tool.request.headers ? tool.request.headers(params) : {})
  const hasBody = method !== 'GET' && method !== 'HEAD' && Boolean(tool.request.body)
  const bodyResult = tool.request.body ? tool.request.body(params) : undefined
  const contentType = headers.get('content-type')
  const isPreformattedContent =
    contentType === 'application/x-ndjson' || contentType === 'application/x-www-form-urlencoded'

  let body: string | undefined
  if (hasBody) {
    if (isPreformattedContent && typeof bodyResult === 'string') {
      body = bodyResult
    } else if (
      isPreformattedContent &&
      bodyResult &&
      typeof bodyResult === 'object' &&
      'body' in bodyResult
    ) {
      body = bodyResult.body as string
    } else {
      body = typeof bodyResult === 'string' ? bodyResult : JSON.stringify(bodyResult)
    }
  }

  const rawTimeout = params.timeout
  const timeout = rawTimeout != null ? Number(rawTimeout) : undefined
  const validTimeout =
    timeout != null && Number.isFinite(timeout) && timeout > 0
      ? Math.min(timeout, getMaxExecutionTimeout())
      : undefined
  const proxyUrl =
    typeof params.proxyUrl === 'string' && params.proxyUrl.trim()
      ? params.proxyUrl.trim()
      : undefined
  const configuredRedirectPolicy = tool.request.redirectPolicy?.(params)
  const redirectPolicy =
    configuredRedirectPolicy && !configuredRedirectPolicy.sendCredentialsOnCrossOriginRedirect
      ? {
          ...configuredRedirectPolicy,
          sensitiveHeaders: [
            ...(configuredRedirectPolicy.sensitiveHeaders ?? []),
            ...collectProvenanceSensitiveHeaders(tool, params, headers, registry),
          ],
        }
      : configuredRedirectPolicy

  return {
    url,
    method,
    headers,
    body,
    timeout: validTimeout,
    proxyUrl,
    stripAuthOnRedirect: tool.request.stripAuthOnRedirect,
    redirectPolicy,
    isInternalRoute,
  }
}

function isInternalRequestDefinition(tool: ToolConfig, params: Record<string, any>): boolean {
  if (typeof tool.request.internal === 'function') return tool.request.internal(params)
  return (
    tool.request.internal === true ||
    (typeof tool.request.url === 'string' && tool.request.url.startsWith('/api/'))
  )
}

function assertRequestUrlMatchesTrust(url: string, isInternalRoute: boolean): void {
  if (isInternalRoute) {
    const pathEnd = url.search(/[?#]/)
    const rawPathname = pathEnd === -1 ? url : url.slice(0, pathEnd)
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url, INTERNAL_REQUEST_BASE_URL)
    } catch {
      throw new Error(INTERNAL_REQUEST_URL_ERROR_MESSAGE)
    }
    const rawSearch = parsedUrl.search.startsWith('?') ? parsedUrl.search.slice(1) : ''
    const canonicalSearch = new URLSearchParams(parsedUrl.search).toString()
    if (
      !url.startsWith('/api/') ||
      parsedUrl.origin !== INTERNAL_REQUEST_BASE_URL ||
      parsedUrl.pathname !== rawPathname ||
      rawSearch !== canonicalSearch ||
      parsedUrl.hash
    ) {
      throw new Error(INTERNAL_REQUEST_URL_ERROR_MESSAGE)
    }
    return
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error(EXTERNAL_REQUEST_URL_ERROR_MESSAGE)
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(EXTERNAL_REQUEST_URL_ERROR_MESSAGE)
  }
}

/** Materializes one tool HTTP request and attaches all private provenance metadata. */
export function prepareToolRequest(
  tool: ToolConfig,
  params: Record<string, any>,
  registry?: ResolvedSecretTraceRegistry
): PreparedToolRequest {
  const modelInput = tool.request.modelInput
  const secretProvenance = tool.request.secretProvenance
  const configuredAsInternal = isInternalRequestDefinition(tool, params)
  const hasPrivateModelInputProvenance =
    modelInput?.mode === 'private-provenance' ||
    (modelInput?.mode === 'project' && modelInput.privateInputPaths !== undefined)

  if (hasPrivateModelInputProvenance && !configuredAsInternal) {
    throw new Error(PRIVATE_MODEL_INPUT_EXTERNAL_URL_ERROR_MESSAGE)
  }
  if (secretProvenance && !configuredAsInternal) {
    throw new Error(PRIVATE_SECRET_PROVENANCE_EXTERNAL_URL_ERROR_MESSAGE)
  }

  const requestInput = projectToolModelInputParams(tool, params, registry)
  const isInternalRoute = isInternalRequestDefinition(tool, requestInput)
  const request = formatToolRequest(tool, requestInput, registry, isInternalRoute)
  if (hasPrivateModelInputProvenance && !request.isInternalRoute) {
    throw new Error(PRIVATE_MODEL_INPUT_EXTERNAL_URL_ERROR_MESSAGE)
  }
  if (secretProvenance && !request.isInternalRoute) {
    throw new Error(PRIVATE_SECRET_PROVENANCE_EXTERNAL_URL_ERROR_MESSAGE)
  }

  const selectedModelInputPaths =
    modelInput?.mode === 'private-provenance'
      ? modelInput.inputPaths(requestInput)
      : modelInput?.mode === 'project'
        ? modelInput.privateInputPaths?.(requestInput)
        : undefined
  const modelInputMetadata = hasPrivateModelInputProvenance
    ? createModelInputProvenanceRequestMetadata(registry, selectedModelInputPaths ?? [])
    : undefined
  const secretProvenanceMetadata = secretProvenance?.request
    ? createPrivateSecretProvenanceRequestMetadata(registry, secretProvenance.request(requestInput))
    : undefined

  if (modelInputMetadata || secretProvenanceMetadata) {
    if (!request.body) throw new Error('Model input provenance requires a JSON request body')

    let requestBody: unknown
    try {
      requestBody = JSON.parse(request.body)
    } catch {
      throw new Error('Model input provenance requires a JSON request body')
    }
    if (!isPlainRecord(requestBody)) {
      throw new Error('Model input provenance request body is invalid')
    }

    const bodyWithModelInputProvenance = addModelInputProvenanceToRequest(
      requestBody,
      request.headers,
      modelInputMetadata
    )
    if (modelInputMetadata && modelInput?.mode === 'project') {
      markModelInputProjected(request.headers)
    }
    request.body = JSON.stringify(
      addModelInputProvenanceToRequest(
        bodyWithModelInputProvenance,
        request.headers,
        secretProvenanceMetadata
      )
    )
  }
  if (!request.headers.has('User-Agent')) request.headers.set('User-Agent', 'Sim')

  return request
}
