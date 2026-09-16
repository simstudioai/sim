import type { JupyterProxyBody } from '@/lib/api/contracts/tools/jupyter'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  buildJupyterAuthHeaders,
  encodeJupyterPath,
  InvalidJupyterServerUrlError,
  normalizeJupyterServerUrl,
} from '@/lib/internal/jupyter/protocol'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

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
  return requestJupyter(input, `api/${input.path}`, MAX_JSON_API_RESPONSE_BYTES, signal)
}

/** Downloads raw file bytes through Jupyter's authenticated `/files/` handler. */
export async function requestJupyterFile(
  input: Pick<JupyterApiRequest, 'serverUrl' | 'token' | 'path'>,
  signal?: AbortSignal
): Promise<SecureFetchResponse> {
  signal?.throwIfAborted()
  const path = encodeJupyterPath(input.path)
  return requestJupyter(
    { serverUrl: input.serverUrl, token: input.token, path: input.path, method: 'GET' },
    `files/${path}?download=1`,
    MAX_BUFFERED_TRANSFER_BYTES,
    signal
  )
}

async function requestJupyter(
  input: JupyterApiRequest,
  route: string,
  maxResponseBytes: number,
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
  const url = `${base}/${route}`

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
    maxResponseBytes,
    signal,
  })
}
