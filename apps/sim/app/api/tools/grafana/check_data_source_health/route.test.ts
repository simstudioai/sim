/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetch, mockValidateUrl, MOCK_MAX_JSON_BYTES } = vi.hoisted(() => ({
  mockSecureFetch: vi.fn(),
  mockValidateUrl: vi.fn(),
  MOCK_MAX_JSON_BYTES: 10 * 1024 * 1024,
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mockSecureFetch,
  validateUrlWithDNS: mockValidateUrl,
  MAX_JSON_API_RESPONSE_BYTES: MOCK_MAX_JSON_BYTES,
}))

import { POST } from '@/app/api/tools/grafana/check_data_source_health/route'

const baseBody = {
  apiKey: 'glsa_token',
  baseUrl: 'https://grafana.example.com',
  dataSourceUid: 'P1234AB5678',
}

function grafanaResponse(body: unknown, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: new Headers(),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

function post(body: Record<string, unknown> = baseBody) {
  return POST(createMockRequest('POST', body) as never, undefined as never)
}

describe('POST /api/tools/grafana/check_data_source_health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockValidateUrl.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
  })

  it('reports a healthy data source', async () => {
    mockSecureFetch.mockResolvedValue(
      grafanaResponse({ status: 'OK', message: 'Data source is working' }, 200)
    )

    const response = await post()
    const data = await response.json()

    expect(data.success).toBe(true)
    expect(data.output).toEqual({ status: 'OK', message: 'Data source is working' })
  })

  it('reports an UNHEALTHY data source, which Grafana answers with HTTP 400', async () => {
    mockSecureFetch.mockResolvedValue(
      grafanaResponse({ status: 'ERROR', message: 'dial tcp: connection refused' }, 400)
    )

    const response = await post()
    const data = await response.json()

    expect(data.success).toBe(true)
    expect(data.output.status).toBe('ERROR')
    expect(data.output.message).toBe('dial tcp: connection refused')
  })

  it('surfaces the plugin details when Grafana supplies them', async () => {
    mockSecureFetch.mockResolvedValue(
      grafanaResponse(
        { status: 'ERROR', message: 'bad query', details: { verboseMessage: 'x' } },
        400
      )
    )

    const response = await post()
    const data = await response.json()

    expect(data.output.details).toEqual({ verboseMessage: 'x' })
  })

  it('treats a failure with no health verdict as a real request failure', async () => {
    mockSecureFetch.mockResolvedValue(grafanaResponse({ message: 'Data source not found' }, 404))

    const response = await post()
    const data = await response.json()

    expect(data.success).toBe(false)
    expect(data.error).toContain('404')
  })

  it('bounds and protects the outbound call', async () => {
    mockSecureFetch.mockResolvedValue(grafanaResponse({ status: 'OK', message: 'ok' }, 200))

    await post()

    const [url, resolvedIP, options] = mockSecureFetch.mock.calls[0]
    expect(resolvedIP).toBe('203.0.113.10')
    expect(url).toBe('https://grafana.example.com/api/datasources/uid/P1234AB5678/health')
    expect(options.maxResponseBytes).toBe(MOCK_MAX_JSON_BYTES)
    expect(options.timeout).toBeGreaterThan(0)
    expect(options.stripAuthOnRedirect).toBe(true)
    expect(options.headers.Authorization).toBe('Bearer glsa_token')
  })

  it('encodes the UID so it cannot re-target the request path', async () => {
    mockSecureFetch.mockResolvedValue(grafanaResponse({ status: 'OK', message: 'ok' }, 200))

    await post({ ...baseBody, dataSourceUid: 'a/../../admin' })

    const [url] = mockSecureFetch.mock.calls[0]
    expect(url).toBe('https://grafana.example.com/api/datasources/uid/a%2F..%2F..%2Fadmin/health')
  })

  it('rejects an unauthenticated request before reaching Grafana', async () => {
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: false,
      error: 'Authentication required',
    })

    const response = await post()

    expect(response.status).toBe(401)
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })
})
