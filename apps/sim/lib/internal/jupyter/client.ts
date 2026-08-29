import type { JupyterProxyBody } from '@/lib/api/contracts/tools/jupyter'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  buildJupyterAuthHeaders,
  InvalidJupyterServerUrlError,
  normalizeJupyterServerUrl,
} from '@/lib/internal/jupyter/protocol'

export class InvalidJupyterTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidJupyterTargetError'
  }
}

export interface JupyterApiRequest {
  serverUrl: string
  token: string
  method: JupyterProxyBody['method']
  path: string
  body?: unknown
}

/** Sends one bounded, DNS-pinned request to a user-supplied Jupyter server. */
export async function requestJupyterApi(
  input: JupyterApiRequest,
  signal?: AbortSignal
): Promise<SecureFetchResponse> {
  signal?.throwIfAborted()
  let base: string
  try {
    base = normalizeJupyterServerUrl(input.serverUrl)
  } catch (error) {
    if (error instanceof InvalidJupyterServerUrlError) {
      throw new InvalidJupyterTargetError(error.message)
    }
    throw error
  }
  const url = `${base}/api/${input.path}`

  const urlValidation = await validateUrlWithDNS(url, 'serverUrl', 'selfHostedService')
  signal?.throwIfAborted()
  if (!urlValidation.isValid) {
    throw new InvalidJupyterTargetError(`Invalid Jupyter serverUrl: ${urlValidation.error}`)
  }

  const hasBody = input.body !== undefined && input.body !== null
  return secureFetchWithPinnedIP(url, urlValidation.resolvedIP, {
    method: input.method,
    headers: {
      ...buildJupyterAuthHeaders(input.token),
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: hasBody ? JSON.stringify(input.body) : undefined,
    profile: 'selfHostedService',
    maxRedirects: 0,
    maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
    signal,
  })
}
