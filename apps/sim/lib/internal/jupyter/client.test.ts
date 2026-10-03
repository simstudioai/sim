import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns

import {
  InvalidJupyterTargetError,
  requestJupyterApi,
  requestJupyterFile,
} from '@/lib/internal/jupyter/client'

describe('Jupyter client', () => {
  beforeEach(() => {
    mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '192.0.2.10',
    })
    mockSecureFetchWithPinnedIP.mockResolvedValue({ ok: true, status: 200 })
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

    expect(mockValidateUrlWithDNS).toHaveBeenCalledWith(
      'http://jupyter.example.com:8888/base/api/kernels',
      'serverUrl',
      'selfHostedService'
    )
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
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
    mockValidateUrlWithDNS.mockResolvedValue({
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
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it.each(['../secret', '%2e%2e/secret', 'data/../secret'])(
    'rejects raw download traversal before DNS: %s',
    async (path) => {
      await expect(
        requestJupyterFile({ serverUrl: 'jupyter.example.com', token: 'token', path })
      ).rejects.toMatchObject({ name: 'UnsafeJupyterPathError' })
      expect(mockValidateUrlWithDNS).not.toHaveBeenCalled()
    }
  )
})
