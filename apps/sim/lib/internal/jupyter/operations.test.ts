/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => {
  class InvalidJupyterTargetError extends Error {}
  return {
    InvalidJupyterTargetError,
    requestJupyterApi: vi.fn(),
  }
})
const fileInputMocks = vi.hoisted(() => ({
  resolveJupyterUploadFile: vi.fn(),
}))

vi.mock('@/lib/internal/jupyter/client', () => clientMocks)
vi.mock('@/lib/internal/jupyter/file-input', () => fileInputMocks)

import { executeJupyterProxy, executeJupyterUpload } from '@/lib/internal/jupyter/operations'

function jupyterResponse(options: {
  ok?: boolean
  status?: number
  contentType?: string | null
  text?: string
  json?: unknown
}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: {
      get: vi.fn().mockReturnValue(options.contentType ?? null),
    },
    text: vi.fn().mockResolvedValue(options.text ?? ''),
    json: vi.fn().mockResolvedValue(options.json),
  }
}

describe('Jupyter operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mirrors upstream proxy status, body, and content type exactly', async () => {
    const controller = new AbortController()
    clientMocks.requestJupyterApi.mockResolvedValue(
      jupyterResponse({
        status: 503,
        contentType: 'application/problem+json',
        text: '{"message":"busy"}',
      })
    )

    const input = {
      serverUrl: 'http://jupyter.example.com',
      token: 'token',
      method: 'GET' as const,
      path: 'kernels',
    }
    const response = await executeJupyterProxy(input, {
      requestId: 'request-1',
      signal: controller.signal,
    })

    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    await expect(response.text()).resolves.toBe('{"message":"busy"}')
    expect(clientMocks.requestJupyterApi).toHaveBeenCalledWith(input, controller.signal)
  })

  it('rejects traversal before contacting Jupyter', async () => {
    const response = await executeJupyterProxy(
      {
        serverUrl: 'http://jupyter.example.com',
        token: 'token',
        method: 'GET',
        path: 'contents/a%2f..%2fsecret',
      },
      { requestId: 'request-1' }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Invalid Jupyter path: contents/a%2f..%2fsecret',
    })
    expect(clientMocks.requestJupyterApi).not.toHaveBeenCalled()
  })

  it('maps DNS target validation to the compatibility response', async () => {
    clientMocks.requestJupyterApi.mockRejectedValue(
      new clientMocks.InvalidJupyterTargetError(
        'Invalid Jupyter serverUrl: private target is blocked'
      )
    )

    const response = await executeJupyterProxy(
      {
        serverUrl: 'http://blocked.example.com',
        token: 'token',
        method: 'GET',
        path: 'kernels',
      },
      { requestId: 'request-1' }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Invalid Jupyter serverUrl: private target is blocked',
    })
  })

  it('uploads resolved bytes and preserves the upload response envelope', async () => {
    const controller = new AbortController()
    fileInputMocks.resolveJupyterUploadFile.mockResolvedValue({
      success: true,
      buffer: Buffer.from('hello'),
      fileName: 'hello world.txt',
    })
    clientMocks.requestJupyterApi.mockResolvedValue(
      jupyterResponse({
        json: {
          name: 'hello world.txt',
          path: 'docs/hello world.txt',
          size: 5,
          last_modified: '2026-08-27T10:00:00Z',
        },
      })
    )

    const input = {
      serverUrl: 'http://jupyter.example.com',
      token: 'token',
      directory: 'docs/',
      fileContent: Buffer.from('ignored').toString('base64'),
    }
    const response = await executeJupyterUpload(input, {
      userId: 'user-1',
      requestId: 'request-1',
      signal: controller.signal,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      output: {
        name: 'hello world.txt',
        path: 'docs/hello world.txt',
        size: 5,
        lastModified: '2026-08-27T10:00:00Z',
      },
    })
    expect(clientMocks.requestJupyterApi).toHaveBeenCalledWith(
      {
        serverUrl: input.serverUrl,
        token: input.token,
        method: 'PUT',
        path: 'contents/docs/hello%20world.txt',
        body: {
          type: 'file',
          format: 'base64',
          content: Buffer.from('hello').toString('base64'),
        },
      },
      controller.signal
    )
  })

  it('preserves upstream upload failures without retrying them', async () => {
    fileInputMocks.resolveJupyterUploadFile.mockResolvedValue({
      success: true,
      buffer: Buffer.from('hello'),
      fileName: 'hello.txt',
    })
    clientMocks.requestJupyterApi.mockResolvedValue(
      jupyterResponse({ ok: false, status: 409, text: 'already exists' })
    )

    const response = await executeJupyterUpload(
      {
        serverUrl: 'http://jupyter.example.com',
        token: 'token',
        fileContent: Buffer.from('hello').toString('base64'),
      },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Jupyter API error: 409 already exists',
    })
    expect(clientMocks.requestJupyterApi).toHaveBeenCalledTimes(1)
  })
})
