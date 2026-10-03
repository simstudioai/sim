import { validateJiraCloudId } from '@/lib/core/security/input-validation'
import { MAX_JSON_API_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { JiraOperationError } from '@/lib/internal/jira/errors'
import { getJiraCloudId } from '@/tools/jira/utils'

interface JiraConnectionConfig {
  domain: string
  accessToken: string
  cloudId?: string | null
}

export interface JiraProviderResponse {
  ok: boolean
  status: number
  statusText: string
  text: string
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

export class JiraClient {
  constructor(
    readonly cloudId: string,
    private readonly accessToken: string
  ) {}

  issuePath(path = ''): string {
    return `https://api.atlassian.com/ex/jira/${this.cloudId}/rest/api/3/issue${path}`
  }

  async request(
    url: string,
    init: RequestInit,
    signal?: AbortSignal
  ): Promise<JiraProviderResponse> {
    signal?.throwIfAborted()
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...init.headers,
      },
      signal,
    })
    const text = await readResponseTextWithLimit(response, {
      maxBytes: MAX_JSON_API_RESPONSE_BYTES,
      label: 'Jira response',
      signal,
      requestMethod: init.method,
    })
    signal?.throwIfAborted()
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text,
    }
  }
}

export async function createJiraClient(
  config: JiraConnectionConfig,
  options: { signal?: AbortSignal; validateCloudId: boolean }
): Promise<JiraClient> {
  options.signal?.throwIfAborted()
  const cloudId =
    config.cloudId ||
    (await waitForDiscovery(getJiraCloudId(config.domain, config.accessToken), options.signal))
  options.signal?.throwIfAborted()

  if (options.validateCloudId) {
    const validation = validateJiraCloudId(cloudId, 'cloudId')
    if (!validation.isValid) {
      throw new JiraOperationError(400, { error: validation.error })
    }
    return new JiraClient(validation.sanitized ?? cloudId, config.accessToken)
  }

  return new JiraClient(cloudId, config.accessToken)
}
