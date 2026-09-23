import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimClient } from '#sim-cli/http/client'
import { finishUploadSession, type UploadSession } from '#sim-cli/transfer/upload-session'

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => {}) }))

let directory: string
let path: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sim-transfer-'))
  path = join(directory, 'fixture.txt')
  await writeFile(path, 'abcdefghijklmnopqr')
  vi.mocked(sleep).mockClear()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

const BASE_PATH = '/api/v2/files/uploads/session'
const RESULT = { status: 'completed', file: { id: 'file' } }

function session(multipart = false): UploadSession {
  return {
    basePath: BASE_PATH,
    uploadToken: 'private-token',
    size: 18,
    completionStatuses: ['completed'],
    completionReplayable: true,
    transfer: multipart
      ? { method: 'multipart', partSize: 2, partCount: 9 }
      : { method: 'put', url: 'https://storage.test/object?signature=private', headers: {} },
  }
}

function setup(
  options: {
    signal?: AbortSignal
    parts?: number[]
    signParts?: () => Response | undefined
    complete?: () => Response
    current?: Record<string, unknown>
  } = {}
) {
  const requests: Request[] = []
  const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push(request)
    if (request.url.includes('/parts?')) {
      const refusal = options.signParts?.()
      if (refusal) return refusal
      return Response.json({
        data: {
          parts: (options.parts ?? [1, 2, 3, 4, 5, 6, 7, 8, 9]).map((partNumber) => ({
            partNumber,
            url: `https://storage.test/part/${partNumber}`,
            headers: {},
          })),
        },
      })
    }
    if (request.url.includes('/complete?'))
      return options.complete?.() ?? Response.json({ data: RESULT })
    if (request.method === 'GET' && options.current) return Response.json({ data: options.current })
    return Response.json({ data: { status: 'aborted' } })
  })
  const client = new SimClient({
    name: 'fixture',
    authProfile: 'fixture',
    endpoint: 'https://sim.test',
    apiKey: 'fixture-key',
    oauth: null,
    workspaceId: 'ws',
    output: 'json',
    sources: { endpoint: 'env', credential: 'env', workspaceId: 'env', output: 'default' },
    transport,
    signal: options.signal,
  })
  return { client, requests, transport }
}

describe('upload session transfers', () => {
  it('keeps at most four replayable multipart requests active and completes only after all bytes arrive', async () => {
    const { client, requests } = setup()
    const release: Array<() => void> = []
    let active = 0
    let peak = 0
    const bytes = new Map<number, string>()
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      const part = Number(input.split('/').at(-1))
      active++
      peak = Math.max(peak, active)
      bytes.set(part, await new Response(init.body).text())
      await new Promise<void>((resolve) => release.push(resolve))
      active--
      return new Response(null, { status: 200 })
    })
    const result = finishUploadSession(client, 'ws', session(true), path)
    await vi.waitFor(() => expect(release).toHaveLength(4))
    expect(requests.some((request) => request.url.includes('/complete?'))).toBe(false)
    release.splice(0).forEach((resolve) => resolve())
    await vi.waitFor(() => expect(release).toHaveLength(4))
    release.splice(0).forEach((resolve) => resolve())
    await vi.waitFor(() => expect(release).toHaveLength(1))
    release.splice(0).forEach((resolve) => resolve())
    await expect(result).resolves.toEqual(RESULT)
    expect(peak).toBe(4)
    expect(
      [...bytes.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, text]) => text)
        .join('')
    ).toBe('abcdefghijklmnopqr')
  })

  it('retries only a refused part, replaying exactly its bytes and honoring Retry-After', async () => {
    const { client } = setup()
    const attempts = new Map<number, string[]>()
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      const part = Number(input.split('/').at(-1))
      const bodies = attempts.get(part) ?? []
      bodies.push(await new Response(init.body).text())
      attempts.set(part, bodies)
      return new Response(
        null,
        part === 2 && bodies.length === 1
          ? { status: 503, headers: { 'retry-after': '2' } }
          : { status: 200 }
      )
    })
    await expect(finishUploadSession(client, 'ws', session(true), path)).resolves.toEqual(RESULT)
    expect(attempts.get(2)).toEqual(['cd', 'cd'])
    expect(
      [...attempts].filter(([part]) => part !== 2).every(([, bodies]) => bodies.length === 1)
    ).toBe(true)
    expect(sleep).toHaveBeenCalledWith(
      2000,
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('verifies a create-only PUT after a lost acknowledgement and precondition refusal', async () => {
    const { client, requests } = setup()
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(finishUploadSession(client, 'ws', session(), path)).resolves.toEqual(RESULT)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(requests.map((request) => request.method)).toEqual(['POST'])
    expect(requests[0].url).toContain('/complete?')
    expect(await new Response(fetcher.mock.calls[0][1].body).text()).toBe('abcdefghijklmnopqr')
    expect(await new Response(fetcher.mock.calls[1][1].body).text()).toBe('abcdefghijklmnopqr')
  })

  it('honors the API Retry-After when obtaining replayable part URLs', async () => {
    let attempts = 0
    const { client } = setup({
      signParts: () => {
        if (++attempts === 1)
          return Response.json(
            { error: { message: 'Busy' } },
            {
              status: 429,
              headers: { 'retry-after': '3' },
            }
          )
        return undefined
      },
    })
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(finishUploadSession(client, 'ws', session(true), path)).resolves.toEqual(RESULT)
    expect(attempts).toBe(2)
    expect(fetcher).toHaveBeenCalledTimes(9)
    expect(sleep).toHaveBeenCalledWith(3000, undefined, { signal: undefined })
  })

  it.each([401, 403, 412])('does not retry a first-attempt HTTP %s refusal', async (status) => {
    const { client, requests } = setup()
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }))
    vi.stubGlobal('fetch', fetcher)
    await expect(finishUploadSession(client, 'ws', session(), path)).rejects.toThrow(
      `status ${status}`
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(requests.map((request) => request.method)).toEqual(['DELETE'])
  })

  it('stops after three transient PUT failures', async () => {
    const { client, requests } = setup()
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(finishUploadSession(client, 'ws', session(), path)).rejects.toThrow('status 503')
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(requests.map((request) => request.method)).toEqual(['DELETE'])
  })

  it('does not shorten a Retry-After that exceeds the retry budget', async () => {
    const { client } = setup()
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'retry-after': '120' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(finishUploadSession(client, 'ws', session(), path)).rejects.toThrow('status 429')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('honors an HTTP-date Retry-After', async () => {
    const { client } = setup()
    const retryAt = Math.ceil((Date.now() + 10_000) / 1000) * 1000
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 503,
          headers: { 'retry-after': new Date(retryAt).toUTCString() },
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(finishUploadSession(client, 'ws', session(), path)).resolves.toEqual(RESULT)
    const delay = vi.mocked(sleep).mock.calls[0][0]
    expect(delay).toBeGreaterThanOrEqual(9000)
    expect(delay).toBeLessThanOrEqual(11_000)
  })

  it('does not start a retry after cancellation during backoff', async () => {
    const cancelled = new AbortController()
    const { client, requests } = setup({ signal: cancelled.signal })
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    vi.mocked(sleep).mockImplementationOnce(async () => {
      cancelled.abort(new Error('Stopped during backoff'))
    })
    await expect(finishUploadSession(client, 'ws', session(), path)).rejects.toThrow(
      'Stopped during backoff'
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(requests.map((request) => request.method)).toEqual(['DELETE'])
  })

  it('cancels and joins sibling transfers before aborting the failed session', async () => {
    const { client, requests } = setup()
    let active = 0
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      active++
      try {
        if (fetcher.mock.calls.length === 1) return new Response(null, { status: 403 })
        await new Promise<void>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
        return new Response(null, { status: 200 })
      } finally {
        active--
      }
    })
    vi.stubGlobal('fetch', fetcher)
    await expect(finishUploadSession(client, 'ws', session(true), path)).rejects.toThrow(
      'status 403'
    )
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(active).toBe(0)
    expect(requests.map((request) => request.method)).toEqual(['POST', 'DELETE'])
  })

  it('cancels signed transfers with the invocation and gives cleanup a live signal', async () => {
    const cancelled = new AbortController()
    const { client, requests } = setup({ signal: cancelled.signal })
    vi.stubGlobal('fetch', async (_input: string, init: RequestInit) => {
      cancelled.abort(new Error('Transfer stopped'))
      init.signal?.throwIfAborted()
      return new Response(null, { status: 200 })
    })
    await expect(finishUploadSession(client, 'ws', session(), path)).rejects.toThrow(
      'Transfer stopped'
    )
    expect(requests).toHaveLength(1)
    expect(requests[0].method).toBe('DELETE')
    expect(requests[0].signal.aborted).toBe(false)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('applies the configured timeout to signed upload acknowledgements', async () => {
    vi.stubEnv('SIM_TIMEOUT_SECONDS', '0.01')
    const { client, requests } = setup()
    vi.stubGlobal('fetch', async (_input: string, init: RequestInit) => {
      await new Promise<void>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
      return new Response(null, { status: 200 })
    })
    await expect(finishUploadSession(client, 'ws', session(), path)).rejects.toThrow(
      'Raise SIM_TIMEOUT_SECONDS'
    )
    expect(sleep).not.toHaveBeenCalled()
    expect(requests[0].method).toBe('DELETE')
  })

  it('retries idempotent completion after its acknowledgement is lost', async () => {
    let attempts = 0
    const { client, requests } = setup({
      complete: () => {
        if (++attempts === 1) throw new TypeError('socket closed')
        return Response.json({ data: RESULT })
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    await expect(finishUploadSession(client, 'ws', session(), path)).resolves.toEqual(RESULT)
    expect(requests.map((request) => request.method)).toEqual(['POST', 'POST'])
  })

  it('preserves the session after an unresolved completion failure', async () => {
    const { client, requests } = setup({
      complete: () => Response.json({ error: { message: 'Unavailable' } }, { status: 503 }),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    await expect(finishUploadSession(client, 'ws', session(), path)).rejects.toMatchObject({
      code: 'UPLOAD_COMPLETION_UNCONFIRMED',
      message: expect.stringContaining('The session was preserved'),
    })
    expect(requests.map((request) => request.method)).toEqual(['POST', 'POST', 'POST', 'GET'])
  })

  it.each(['completed', 'processing'])(
    'recovers a lost completion from authoritative %s status',
    async (status) => {
      const current = { ...RESULT, status }
      const { client, requests } = setup({
        complete: () => Response.json({ error: { message: 'Unavailable' } }, { status: 503 }),
        current,
      })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
      const transfer = session()
      if (status === 'processing') {
        transfer.basePath = '/api/v2/tables/imports/session'
        transfer.completionStatuses = ['processing', 'completed']
        transfer.completionReplayable = false
      }
      await expect(finishUploadSession(client, 'ws', transfer, path)).resolves.toEqual(current)
      expect(requests.map((request) => request.method)).toEqual(
        status === 'processing' ? ['POST', 'GET'] : ['POST', 'POST', 'POST', 'GET']
      )
    }
  )

  it.each([
    [1, 1, 3, 4, 5, 6, 7, 8, 9],
    [1, 2],
  ])('refuses an incomplete or repeated part manifest', async (...parts) => {
    const { client, requests } = setup({ parts })
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(finishUploadSession(client, 'ws', session(true), path)).rejects.toThrow(
      'do not match'
    )
    expect(fetcher).not.toHaveBeenCalled()
    expect(requests.at(-1)?.method).toBe('DELETE')
  })

  it('refuses local files whose size changed after creating the session', async () => {
    const { client } = setup()
    await writeFile(path, 'changed')
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(finishUploadSession(client, 'ws', session(), path)).rejects.toThrow('size changed')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
