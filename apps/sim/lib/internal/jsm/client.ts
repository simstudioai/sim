import {
  validateAssetsWorkspaceId,
  validateJiraCloudId,
} from '@/lib/core/security/input-validation'
import { JsmOperationError } from '@/lib/internal/jsm/errors'
import { getJiraCloudId, parseAtlassianErrorMessage } from '@/tools/jira/utils'
import { resolveAssetsContext } from '@/tools/jsm/utils'

export interface JsmConnectionConfig {
  domain: string
  accessToken: string
  cloudId?: string
}

export interface JsmAssetsConnectionConfig extends JsmConnectionConfig {
  workspaceId?: string
}

export type JsonObject = Record<string, unknown>

export function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function nested(object: JsonObject, ...keys: string[]): unknown {
  let value: unknown = object
  for (const key of keys) value = asObject(value)[key]
  return value
}

function waitForDiscovery<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (result) => {
        cleanup()
        resolve(result)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      }
    )
  })
}

export class JsmClient {
  constructor(
    readonly cloudId: string,
    private readonly accessToken: string,
    readonly workspaceId?: string
  ) {}

  service(path: string): string {
    return `https://api.atlassian.com/ex/jira/${this.cloudId}/rest/servicedeskapi${path}`
  }

  forms(path: string): string {
    return `https://api.atlassian.com/ex/jira/${this.cloudId}/forms${path}`
  }

  assets(path: string): string {
    if (!this.workspaceId) throw new Error('JSM Assets client requires a workspace ID')
    return `https://api.atlassian.com/ex/jira/${this.cloudId}/jsm/assets/workspace/${this.workspaceId}/v1${path}`
  }

  async fetch(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    signal?.throwIfAborted()
    return fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-ExperimentalApi': 'opt-in',
        ...init.headers,
      },
      signal,
    })
  }

  async json(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
    includeProviderDetails = false
  ): Promise<JsonObject> {
    return asObject(await this.value(path, init, signal, includeProviderDetails))
  }

  async value(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
    includeProviderDetails = false
  ): Promise<unknown> {
    const response = await this.fetch(path, init, signal)
    if (!response.ok) await throwJsmResponseError(response, includeProviderDetails)
    return response.json()
  }

  async empty(
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
    includeProviderDetails = false
  ): Promise<void> {
    const response = await this.fetch(path, init, signal)
    if (!response.ok) await throwJsmResponseError(response, includeProviderDetails)
    await response.arrayBuffer()
  }

  async optionalJson(
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
    includeProviderDetails = false
  ): Promise<JsonObject> {
    const response = await this.fetch(path, init, signal)
    if (!response.ok) await throwJsmResponseError(response, includeProviderDetails)
    const text = await response.text()
    return text ? asObject(JSON.parse(text)) : {}
  }
}

export async function throwJsmResponseError(
  response: Response,
  includeProviderDetails = false
): Promise<never> {
  const errorText = await response.text()
  const message = parseAtlassianErrorMessage(response.status, response.statusText, errorText)
  throw new JsmOperationError(
    message,
    response.status,
    includeProviderDetails ? { error: message, details: errorText } : undefined
  )
}

export async function createJsmClient(
  config: JsmConnectionConfig,
  signal?: AbortSignal
): Promise<JsmClient> {
  signal?.throwIfAborted()
  const cloudId =
    config.cloudId ||
    (await waitForDiscovery(getJiraCloudId(config.domain, config.accessToken), signal))
  signal?.throwIfAborted()
  const validation = validateJiraCloudId(cloudId, 'cloudId')
  if (!validation.isValid) {
    throw new JsmOperationError(validation.error || 'Invalid cloudId', 400)
  }
  return new JsmClient(validation.sanitized ?? cloudId, config.accessToken)
}

export async function createJsmAssetsClient(
  config: JsmAssetsConnectionConfig,
  signal?: AbortSignal
): Promise<JsmClient> {
  signal?.throwIfAborted()
  const context = await waitForDiscovery(
    resolveAssetsContext(config.domain, config.accessToken, config.cloudId, config.workspaceId),
    signal
  )
  signal?.throwIfAborted()
  const cloudId = validateJiraCloudId(context.cloudId, 'cloudId')
  if (!cloudId.isValid) throw new JsmOperationError(cloudId.error || 'Invalid cloudId', 400)
  const workspaceId = validateAssetsWorkspaceId(context.workspaceId, 'workspaceId')
  if (!workspaceId.isValid) {
    throw new JsmOperationError(workspaceId.error || 'Invalid workspaceId', 400)
  }
  return new JsmClient(
    cloudId.sanitized ?? context.cloudId,
    config.accessToken,
    workspaceId.sanitized ?? context.workspaceId
  )
}
