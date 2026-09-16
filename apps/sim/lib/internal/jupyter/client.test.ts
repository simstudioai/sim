/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const securityMocks = vi.hoisted(() => ({
  validateUrlWithDNS: vi.fn(),
  secureFetchWithPinnedIP: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
  validateUrlWithDNS: securityMocks.validateUrlWithDNS,
  secureFetchWithPinnedIP: securityMocks.secureFetchWithPinnedIP,
}))

import {
  InvalidJupyterTargetError,
  requestJupyterApi,
  requestJupyterFile,
} from '@/lib/internal/jupyter/client'

describe('Jupyter client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    securityMocks.validateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '192.0.2.10',
    })
    securityMocks.secureFetchWithPinnedIP.mockResolvedValue({ ok: true, status: 200 })
  })

  it('sends one bounded, non-redirecting request with token auth and cancellation', async () => {
    const controller = new AbortController()

    await requestJupyterApi(
      {
        serverUrl: 'jupyter.example.com:8888/base/',
        token: 'secret-token',
        method: 'POST',
        path: 'kernels',
        body: { name: 'python3' },
      },
      controller.signal
    )

    expect(securityMocks.validateUrlWithDNS).toHaveBeenCalledWith(
      'http://jupyter.example.com:8888/base/api/kernels',
      'serverUrl',
      'selfHostedService'
    )
    expect(securityMocks.secureFetchWithPinnedIP).toHaveBeenCalledWith(
      'http://jupyter.example.com:8888/base/api/kernels',
      '192.0.2.10',
      {
        method: 'POST',
        headers: {
          Authorization: 'token secret-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'python3' }),
        profile: 'selfHostedService',
        maxRedirects: 0,
        maxResponseBytes: 10 * 1024 * 1024,
        signal: controller.signal,
      }
    )
  })

  it('rejects an invalid DNS-resolved target before starting network work', async () => {
    securityMocks.validateUrlWithDNS.mockResolvedValue({
      isValid: false,
      error: 'host is blocked',
    })

    await expect(
      requestJupyterApi({
        serverUrl: 'blocked.example.com',
        token: 'token',
        method: 'GET',
        path: 'kernels',
      })
    ).rejects.toEqual(new InvalidJupyterTargetError('Invalid Jupyter serverUrl: host is blocked'))
    expect(securityMocks.secureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('classifies malformed server URLs before starting DNS work', async () => {
    await expect(
      requestJupyterApi({
        serverUrl: 'http://[invalid',
        token: 'token',
        method: 'GET',
        path: 'kernels',
      })
    ).rejects.toEqual(new InvalidJupyterTargetError('Invalid Jupyter server URL: http://[invalid'))
    expect(securityMocks.validateUrlWithDNS).not.toHaveBeenCalled()
  })

  it('does not start DNS work after cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      requestJupyterApi(
        {
          serverUrl: 'jupyter.example.com',
          token: 'token',
          method: 'GET',
          path: 'sessions',
        },
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(securityMocks.validateUrlWithDNS).not.toHaveBeenCalled()
  })

  it('downloads raw bytes with token auth, the server base path, and a separate 100 MiB cap', async () => {
    const controller = new AbortController()
    await requestJupyterFile(
      {
        serverUrl: 'https://jupyter.example.com/user/alice/',
        token: 'secret-token',
        path: 'datasets/report #1.xlsx',
      },
      controller.signal
    )

    const url =
      'https://jupyter.example.com/user/alice/files/datasets/report%20%231.xlsx?download=1'
    expect(securityMocks.validateUrlWithDNS).toHaveBeenCalledWith(
      url,
      'serverUrl',
      'selfHostedService'
    )
    expect(securityMocks.secureFetchWithPinnedIP).toHaveBeenCalledWith(url, '192.0.2.10', {
      method: 'GET',
      headers: { Authorization: 'token secret-token' },
      body: undefined,
      profile: 'selfHostedService',
      maxRedirects: 0,
      maxResponseBytes: 100 * 1024 * 1024,
      signal: controller.signal,
    })
  })

  it.each(['../secret', '%2e%2e/secret', 'data/../secret'])(
    'rejects raw download traversal before DNS: %s',
    async (path) => {
      await expect(
        requestJupyterFile({ serverUrl: 'jupyter.example.com', token: 'token', path })
      ).rejects.toMatchObject({ name: 'UnsafeJupyterPathError' })
      expect(securityMocks.validateUrlWithDNS).not.toHaveBeenCalled()
    }
  )

  it('rejects a raw file target blocked by DNS policy', async () => {
    securityMocks.validateUrlWithDNS.mockResolvedValue({ isValid: false, error: 'blocked' })
    await expect(
      requestJupyterFile({ serverUrl: 'jupyter.example.com', token: 'token', path: 'data.csv' })
    ).rejects.toBeInstanceOf(InvalidJupyterTargetError)
    expect(securityMocks.secureFetchWithPinnedIP).not.toHaveBeenCalled()
  })
})
