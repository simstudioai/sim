import { isDeepStrictEqual } from 'node:util'
import { isPlainRecord } from '@sim/utils/object'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import type { HttpRedirectPolicy } from '@/lib/core/security/http-redirect-policy'
import { refuseResolvedSecretProjection } from '@/executor/utils/resolved-secret-projection-refusal'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import {
  type ExecutableToolConfig,
  isInternalToolConfig,
  type ToolConfig,
  type ToolDefinition,
} from '@/tools/types'

const MODEL_INPUT_PROJECTION_ERROR_MESSAGE = 'Model input could not be safely projected'
const PRIVATE_MODEL_INPUT_EXTERNAL_URL_ERROR_MESSAGE =
  'Private model input provenance requires an in-process operation'
const PRIVATE_SECRET_PROVENANCE_EXTERNAL_URL_ERROR_MESSAGE =
  'Private secret provenance requires an in-process operation'
const EXTERNAL_REQUEST_URL_ERROR_MESSAGE = 'External tool requests require an absolute HTTP(S) URL'

export interface PreparedToolRequest {
  url: string
  method: string
  headers: Headers
  body?: string
  timeout?: number
  proxyUrl?: string
  stripAuthOnRedirect?: boolean
  redirectPolicy?: HttpRedirectPolicy
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
  tool: ToolDefinition,
  selected: unknown
): { record: Record<string, unknown>; entries: Array<[string, unknown]> } | undefined {
  if (!isPlainRecord(selected)) return undefined

  const entries = getOwnEnumerableDataEntries(selected)
  if (!entries || entries.some(([key]) => !Object.hasOwn(tool.params, key))) return undefined
  return { record: selected, entries }
}

export function projectToolModelInputParams(
  tool: ExecutableToolConfig,
  params: Record<string, any>,
  registry: ResolvedSecretTraceRegistry | undefined
): Record<string, any> {
  const modelInput = isInternalToolConfig(tool)
    ? tool.operation.modelInput
    : tool.request.modelInput
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
  registry: ResolvedSecretTraceRegistry | undefined
): PreparedToolRequest {
  const url = typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url
  assertExternalRequestUrl(url)
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
  }
}

function assertExternalRequestUrl(url: string): void {
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

/** Materializes one external HTTP request after enforcing the model-input boundary. */
export function prepareToolRequest(
  tool: ToolConfig,
  params: Record<string, any>,
  registry?: ResolvedSecretTraceRegistry
): PreparedToolRequest {
  const modelInput = tool.request.modelInput
  const secretProvenance = tool.request.secretProvenance
  const hasPrivateModelInputProvenance =
    modelInput?.mode === 'private-provenance' ||
    (modelInput?.mode === 'project' && modelInput.privateInputPaths !== undefined)

  if (hasPrivateModelInputProvenance) {
    throw new Error(PRIVATE_MODEL_INPUT_EXTERNAL_URL_ERROR_MESSAGE)
  }
  if (secretProvenance) {
    throw new Error(PRIVATE_SECRET_PROVENANCE_EXTERNAL_URL_ERROR_MESSAGE)
  }

  const requestInput = projectToolModelInputParams(tool, params, registry)
  const request = formatToolRequest(tool, requestInput, registry)
  if (!request.headers.has('User-Agent')) request.headers.set('User-Agent', 'Sim')

  return request
}
