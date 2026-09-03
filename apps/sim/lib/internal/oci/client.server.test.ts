/**
 * @vitest-environment node
 */
import { generateKeyPairSync } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const secureFetchMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithValidation: secureFetchMock,
}))

import {
  buildOciRequestUrl,
  sendOciRequest,
  serializeOciQueryPairs,
} from '@/lib/internal/oci/client.server'
import { getOciRegion, objectStorageOciDestination } from '@/lib/internal/oci/endpoints'
import { OciRequestError } from '@/lib/internal/oci/errors'
import type { OciSigningCredentials } from '@/lib/internal/oci/signing.server'

function secureResponse(params: {
  ok: boolean
  status: number
  body?: string
  opcRequestId?: string
}) {
  return {
    ok: params.ok,
    status: params.status,
    statusText: '',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'opc-request-id' ? (params.opcRequestId ?? null) : null,
    },
    body: null,
    text: vi.fn().mockResolvedValue(params.body ?? ''),
    json: vi.fn(),
    arrayBuffer: vi.fn(),
  }
}

describe('OCI request client', () => {
  let credentials: OciSigningCredentials
  const destination = objectStorageOciDestination(getOciRegion('us-ashburn-1'))

  beforeAll(() => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
    credentials = {
      tenancyId: 'ocid1.tenancy.oc1..clienttest',
      userId: 'ocid1.user.oc1..clienttest',
      fingerprint: '00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff',
      privateKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      passphrase: 'client-secret-passphrase',
    }
  })

  beforeEach(() => {
    secureFetchMock.mockReset()
    secureFetchMock.mockResolvedValue(secureResponse({ ok: true, status: 200 }))
  })

  it('serializes ordered duplicate and Unicode query pairs with RFC 3986 encoding', () => {
    expect(
      serializeOciQueryPairs([
        ['z', 'last'],
        ['a', 'one'],
        ['a', ''],
        ['space', 'a b'],
        ['unicode', '☃'],
        ["!'()*", "!'()*"],
      ])
    ).toBe('z=last&a=one&a=&space=a%20b&unicode=%E2%98%83&%21%27%28%29%2A=%21%27%28%29%2A')
  })

  it('transmits the exact URL, finalized body, and headers that were signed', async () => {
    const body = '{"message":"héllo ☃"}'
    await sendOciRequest({
      destination,
      credentials,
      method: 'POST',
      encodedPath: '/n/tenant/b',
      queryPairs: [
        ['z', 'last'],
        ['a', 'one'],
        ['a', ''],
        ['unicode', '☃'],
      ],
      timeout: 12_345,
      maxResponseBytes: 54_321,
      serviceHeaders: { accept: 'application/json', 'opc-retry-token': 'fixed-token' },
      body,
    })

    expect(secureFetchMock).toHaveBeenCalledOnce()
    const [url, options, paramName] = secureFetchMock.mock.calls[0]
    expect(url).toBe(
      'https://objectstorage.us-ashburn-1.oraclecloud.com/n/tenant/b?z=last&a=one&a=&unicode=%E2%98%83'
    )
    expect(paramName).toBe('OCI destination')
    expect(options).toMatchObject({
      method: 'POST',
      body,
      timeout: 12_345,
      maxResponseBytes: 54_321,
      maxRedirects: 0,
      profile: 'configuredEndpoint',
      logUrlValidationDetails: false,
    })
    expect(options.headers.accept).toBe('application/json')
    expect(options.headers['opc-retry-token']).toBe('fixed-token')
    expect(options.headers.authorization).toContain('Signature version="1"')
    expect(options.headers['content-length']).toBe(String(Buffer.byteLength(body, 'utf8')))
    expect(options.headers).not.toHaveProperty('date')
  })

  it('forwards cancellation and always disables redirects', async () => {
    const controller = new AbortController()
    await sendOciRequest({
      destination,
      credentials,
      method: 'GET',
      encodedPath: '/n/',
      timeout: 10_000,
      maxResponseBytes: 65_536,
      signal: controller.signal,
    })
    expect(secureFetchMock.mock.calls[0][1]).toMatchObject({
      signal: controller.signal,
      timeout: 10_000,
      maxResponseBytes: 65_536,
      maxRedirects: 0,
    })
  })

  it('returns bounded successful responses and the OCI request id without imposing a schema', async () => {
    const response = secureResponse({
      ok: true,
      status: 202,
      body: 'service-specific bytes',
      opcRequestId: 'request-123',
    })
    secureFetchMock.mockResolvedValueOnce(response)
    const result = await sendOciRequest({
      destination,
      credentials,
      method: 'GET',
      encodedPath: '/n/',
      timeout: 10_000,
      maxResponseBytes: 65_536,
    })
    expect(result).toEqual({ response, opcRequestId: 'request-123' })
    expect(response.text).not.toHaveBeenCalled()
  })

  it('retains bounded OCI error fields and request ids while redacting echoed secrets', async () => {
    const echoedUrl = 'https://objectstorage.us-ashburn-1.oraclecloud.com/n/'
    secureFetchMock.mockResolvedValueOnce(
      secureResponse({
        ok: false,
        status: 401,
        opcRequestId: 'request-401',
        body: JSON.stringify({
          code: 'NotAuthenticated',
          message: `provider echoed ${credentials.passphrase} ${credentials.privateKey} ${echoedUrl}\n`,
        }),
      })
    )
    const failure = await sendOciRequest({
      destination,
      credentials,
      method: 'GET',
      encodedPath: '/n/',
      timeout: 10_000,
      maxResponseBytes: 65_536,
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(OciRequestError)
    expect(failure).toMatchObject({
      status: 401,
      code: 'NotAuthenticated',
      opcRequestId: 'request-401',
    })
    expect((failure as Error).message).toContain('[redacted]')
    expect((failure as Error).message).not.toContain('client-secret-passphrase')
    expect((failure as Error).message).not.toContain('BEGIN PRIVATE KEY')
    expect((failure as Error).message).not.toContain('objectstorage.us-ashburn-1')
    expect((failure as Error).message.length).toBeLessThanOrEqual(1050)
  })

  it('does not expose malformed response bodies or signed request details', async () => {
    secureFetchMock.mockResolvedValueOnce(
      secureResponse({
        ok: false,
        status: 502,
        opcRequestId: 'request-502',
        body: `<html>${credentials.privateKey}</html>`,
      })
    )
    const failure = await sendOciRequest({
      destination,
      credentials,
      method: 'GET',
      encodedPath: '/n/',
      timeout: 10_000,
      maxResponseBytes: 65_536,
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(OciRequestError)
    expect((failure as Error).message).toBe('OCI request failed with status 502')
    expect((failure as OciRequestError).opcRequestId).toBe('request-502')
  })

  it.each([
    '//attacker.example/path',
    '/safe//attacker',
    '/path?injected=true',
    '/path#fragment',
    '/path\\replacement',
    '/path%ZZ',
  ])('rejects unsafe encoded paths: %s', (encodedPath) => {
    expect(() => buildOciRequestUrl(destination, encodedPath)).toThrow(
      'single encoded absolute path'
    )
  })

  it('rejects invalid transport bounds before signing or sending', async () => {
    for (const invalid of [0, -1, Number.NaN, 300_001]) {
      await expect(
        sendOciRequest({
          destination,
          credentials,
          method: 'GET',
          encodedPath: '/n/',
          timeout: invalid,
          maxResponseBytes: 65_536,
        })
      ).rejects.toThrow('timeout')
    }
    await expect(
      sendOciRequest({
        destination,
        credentials,
        method: 'GET',
        encodedPath: '/n/',
        timeout: 10_000,
        maxResponseBytes: 100 * 1024 * 1024 + 1,
      })
    ).rejects.toThrow('response ceiling')
    expect(secureFetchMock).not.toHaveBeenCalled()
  })

  it('propagates a bounded response-ceiling failure without adding request material', async () => {
    secureFetchMock.mockRejectedValueOnce(new Error('Response exceeded the configured byte limit'))
    const failure = await sendOciRequest({
      destination,
      credentials,
      method: 'GET',
      encodedPath: '/n/',
      timeout: 10_000,
      maxResponseBytes: 64,
    }).catch((error: unknown) => error)
    expect((failure as Error).message).toBe('Response exceeded the configured byte limit')
    expect((failure as Error).message).not.toContain('authorization')
    expect((failure as Error).message).not.toContain(destination.hostname)
  })
})
