import { afterEach, describe, expect, it, vi } from 'vitest'
import { runEmbeddedCli } from '../embed'
import { StreamingUpload } from './streaming-upload'

afterEach(() => vi.unstubAllGlobals())

describe('streamed upload bytes', () => {
  it('sends streamed multipart bytes with exact lengths over HTTP', async () => {
    const original = Uint8Array.from({ length: 256 * 1024 + 19 }, (_, index) => index % 251)
    const partSize = 128 * 1024
    const errors: unknown[] = []
    const receivedParts: number[] = []
    let endpoint = ''
    const server = createServer(async (request, response) => {
      try {
        if (request.url?.startsWith('/data/')) {
          const part = Number(request.url.slice('/data/'.length))
          const start = (part - 1) * partSize
          const expected = original.subarray(start, Math.min(start + partSize, original.length))
          expect(request.headers['content-length']).toBe(String(expected.length))
          expect(request.headers['transfer-encoding']).toBeUndefined()
          let offset = 0
          for await (const value of request) {
            const chunk = Buffer.from(value)
            expect(chunk.equals(expected.subarray(offset, offset + chunk.length))).toBe(true)
            offset += chunk.length
          }
          expect(offset).toBe(expected.length)
          receivedParts.push(part)
          response.end()
          return
        }
        response.setHeader('content-type', 'application/json')
        if (request.url?.includes('/complete?')) {
          response.end(JSON.stringify({ data: { file: { id: 'file' } } }))
        } else if (request.url?.includes('/parts?')) {
          response.end(
            JSON.stringify({
              data: {
                parts: [1, 2, 3].map((partNumber) => ({
                  partNumber,
                  url: `${endpoint}/data/${partNumber}`,
                  headers: {},
                })),
              },
            })
          )
        } else {
          response.end(
            JSON.stringify({
              data: {
                session: { id: 'upload' },
                uploadToken: 'fixture',
                transfer: { method: 'multipart', partSize, partCount: 3 },
              },
            })
          )
        }
      } catch (error) {
        errors.push(error)
        response.statusCode = 500
        response.end()
      }
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing local server address')
      endpoint = `http://127.0.0.1:${address.port}`
      let offset = 0
      const result = await runEmbeddedCli(
        ['files', 'upload', 'bytes.bin'],
        { endpoint, apiKey: 'fixture', workspaceId: 'ws' },
        {
          openFile: async () => ({
            size: original.length,
            stream: async () =>
              new ReadableStream<Uint8Array>({
                pull(controller) {
                  if (offset === original.length) controller.close()
                  else {
                    const next = Math.min(offset + 4096, original.length)
                    controller.enqueue(original.subarray(offset, next))
                    offset = next
                  }
                },
              }),
            dispose: async () => {},
          }),
        }
      )
      expect(errors).toEqual([])
      expect(result, result.stderr).toMatchObject({ exitCode: 0 })
      expect(receivedParts).toEqual([1, 2, 3])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('splits provider chunks across part boundaries without pre-reading the file', async () => {
    let pulls = 0
    const original = Uint8Array.from([0, 255, 13, 10, 128, 195, 64])
    const source = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++
          if (pulls === 1) controller.enqueue(original)
          else controller.close()
        },
      },
      { highWaterMark: 0 }
    )
    const upload = new StreamingUpload(source, original.length)
    try {
      const first = upload.slice(0, 3)
      expect(pulls).toBe(0)
      expect(new Uint8Array(await new Response(first).arrayBuffer())).toEqual(
        original.subarray(0, 3)
      )
      expect(pulls).toBe(1)
      expect(new Uint8Array(await new Response(upload.slice(3, 7)).arrayBuffer())).toEqual(
        original.subarray(3)
      )
      expect(pulls).toBe(1)
      await upload.verifyComplete()
      expect(pulls).toBe(2)
    } finally {
      await upload.close()
    }
    expect(source.locked).toBe(false)
  })

  it.each(['short', 'long', 'read failure', 'early acknowledgement', 'HTTP failure'])(
    'refuses completion and aborts its transfer after %s',
    async (fault) => {
      const calls: string[] = []
      const dispose = vi.fn(async () => {})
      const cancelled = vi.fn()
      let streamedSignal: AbortSignal | null | undefined
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          if (fault === 'read failure') controller.error(new Error('Provider read failed'))
          else if (fault !== 'early acknowledgement') {
            controller.enqueue(new Uint8Array(fault === 'short' ? 2 : fault === 'long' ? 6 : 4))
            controller.close()
          }
        },
        cancel: cancelled,
      })
      const transport = async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init)
        calls.push(request.method)
        if (request.method === 'DELETE') {
          expect(streamedSignal?.aborted).toBe(true)
          return Response.json({ data: { status: 'aborted' } })
        }
        return Response.json({
          data: {
            session: { id: 'upload' },
            uploadToken: 'fixture',
            transfer: { method: 'put', url: 'https://upload.test/data', headers: {} },
          },
        })
      }
      vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
        streamedSignal = init?.signal
        if (fault !== 'early acknowledgement' && fault !== 'HTTP failure') {
          await new Request(input, init).arrayBuffer()
        }
        return new Response(null, { status: fault === 'HTTP failure' ? 503 : 200 })
      })
      const result = await runEmbeddedCli(
        ['files', 'upload', 'out.bin'],
        { endpoint: 'https://sim.test', apiKey: 'fixture', workspaceId: 'ws', transport },
        { openFile: async () => ({ size: 4, stream: async () => source, dispose }) }
      )
      expect(result.exitCode).toBe(1)
      expect(calls).toEqual(['POST', 'DELETE'])
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(source.locked).toBe(false)
      if (fault === 'early acknowledgement') expect(cancelled).toHaveBeenCalledTimes(1)
    }
  )

  it('keeps the host snapshot deadline active while waiting for an upload acknowledgement', async () => {
    const deadline = new AbortController()
    const calls: string[] = []
    const dispose = vi.fn(async () => {})
    const transport = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      calls.push(request.method)
      if (request.method === 'DELETE') {
        expect(request.signal.aborted).toBe(false)
        return Response.json({ data: { status: 'aborted' } })
      }
      if (request.url.includes('/complete?'))
        return Response.json({ data: { file: { id: 'file' } } })
      return Response.json({
        data: {
          session: { id: 'upload' },
          uploadToken: 'fixture',
          transfer: { method: 'put', url: 'https://upload.test/data', headers: {} },
        },
      })
    }
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      await new Request(input, init).arrayBuffer()
      deadline.abort(new Error('Workbench snapshot expired'))
      init?.signal?.throwIfAborted()
      return new Response(null, { status: 200 })
    })
    const result = await runEmbeddedCli(
      ['files', 'upload', 'data.bin'],
      { endpoint: 'https://sim.test', apiKey: 'fixture', workspaceId: 'ws', transport },
      {
        openFile: async () => ({
          size: 4,
          signal: deadline.signal,
          stream: async () => new Blob(['data']).stream(),
          dispose,
        }),
      }
    )
    expect(result).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('snapshot expired'),
    })
    expect(calls).toEqual(['POST', 'DELETE'])
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('requests another URL batch without rereading or buffering earlier file parts', async () => {
    const original = Uint8Array.from({ length: 207 }, (_, index) => index % 256)
    const parts: number[] = []
    const batches: number[][] = []
    const dispose = vi.fn(async () => {})
    const transport = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.url.includes('/complete?')) {
        return Response.json({ data: { file: { id: 'file' } } })
      }
      if (request.url.includes('/parts?')) {
        const payload = await request.json()
        if (
          !payload ||
          typeof payload !== 'object' ||
          !('partNumbers' in payload) ||
          !Array.isArray(payload.partNumbers) ||
          !payload.partNumbers.every((part): part is number => typeof part === 'number')
        )
          throw new Error('Invalid part URL request')
        const numbers = payload.partNumbers
        batches.push(numbers)
        return Response.json({
          data: {
            parts: numbers.map((partNumber) => ({
              partNumber,
              url: `https://upload.test/${partNumber}`,
              headers: {},
            })),
          },
        })
      }
      return Response.json({
        data: {
          session: { id: 'upload' },
          uploadToken: 'fixture',
          transfer: { method: 'multipart', partSize: 2, partCount: 104 },
        },
      })
    }
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      const part = Number(new URL(request.url).pathname.slice(1))
      parts.push(part)
      expect(new Uint8Array(await request.arrayBuffer())).toEqual(
        original.subarray((part - 1) * 2, part * 2)
      )
      return new Response(null, { status: 200 })
    })
    const stream = vi.fn(async () => new Blob([original]).stream())
    const result = await runEmbeddedCli(
      ['files', 'upload', 'data.bin'],
      { endpoint: 'https://sim.test', apiKey: 'fixture', workspaceId: 'ws', transport },
      { openFile: async () => ({ size: original.length, stream, dispose }) }
    )
    expect(result, result.stderr).toMatchObject({ exitCode: 0 })
    expect(parts).toEqual(Array.from({ length: 104 }, (_, index) => index + 1))
    expect(batches.map((batch) => batch.length)).toEqual([100, 4])
    expect(stream).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

import { createServer } from 'node:http'
