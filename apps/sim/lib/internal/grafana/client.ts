import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'

const OUTBOUND_FETCH_TIMEOUT_MS = 30_000

export type GrafanaClientResult =
  | { success: true; response: Awaited<ReturnType<typeof secureFetchWithPinnedIP>> }
  | { success: false; error: string }

export class GrafanaClient {
  private readonly baseUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly organizationId?: string,
    private readonly signal?: AbortSignal
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async request(
    path: string,
    options: { method: 'GET' | 'POST' | 'PUT'; body?: unknown; headers?: Record<string, string> }
  ): Promise<GrafanaClientResult> {
    this.signal?.throwIfAborted()
    const url = `${this.baseUrl}${path}`
    const validation = await validateUrlWithDNS(url, 'baseUrl')
    this.signal?.throwIfAborted()
    if (!validation.isValid || !validation.resolvedIP) {
      return { success: false, error: `Invalid Grafana baseUrl: ${validation.error}` }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...options.headers,
    }
    if (this.organizationId) headers['X-Grafana-Org-Id'] = this.organizationId

    const response = await secureFetchWithPinnedIP(url, validation.resolvedIP, {
      method: options.method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      timeout: OUTBOUND_FETCH_TIMEOUT_MS,
      stripAuthOnRedirect: true,
      signal: this.signal,
    })
    this.signal?.throwIfAborted()
    return { success: true, response }
  }
}
