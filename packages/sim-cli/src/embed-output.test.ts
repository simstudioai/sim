import { afterEach, describe, expect, it, vi } from 'vitest'
import { runEmbeddedCli } from './embed'

const identity = { endpoint: 'https://sim.test', apiKey: 'fixture', workspaceId: 'workspace' }
afterEach(() => vi.unstubAllGlobals())

function download(chunks: Uint8Array[], cancel = vi.fn()): Response {
  let position = 0
  return new Response(
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = chunks[position++]
          if (chunk) controller.enqueue(chunk)
          else controller.close()
        },
        cancel,
      },
      { highWaterMark: 0 }
    ),
    { headers: { 'content-type': 'application/json' } }
  )
}

describe('embedded output through the real command tree', () => {
  it('preserves JSON, whitespace and split UTF-8 across arbitrary response chunks', async () => {
    const content = '  {"city":"東京","emoji":"🛠️","lines":"one\\ntwo"}\n\n'
    const bytes = Buffer.from(content)
    const result = await runEmbeddedCli(['files', 'get', 'file'], {
      ...identity,
      transport: async () => download([...bytes].map((byte) => Uint8Array.of(byte))),
    })
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout).toBe(content)
    expect(JSON.parse(result.stdout)).toEqual(JSON.parse(content))
  })

  it('keeps stream writes adjacent and adds newlines only for console lines', async () => {
    const result = await runEmbeddedCli(['files', 'get', 'file'], {
      ...identity,
      transport: async () => {
        process.stderr.write('progress: ')
        process.stderr.write('1')
        console.error(' of %d', 2)
        console.error('')
        return download([Buffer.from('{}')])
      },
    })
    expect(result.stderr).toBe('progress: 1 of 2\n\n')
    expect(result.stdout).toBe('{}')
  })

  it('stops oversized stdout at capture, cancels the body and reports incomplete output', async () => {
    let produced = 0
    const cancel = vi.fn()
    const chunk = new Uint8Array(1024 * 1024).fill(120)
    const transport = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                if (produced++ < 24) controller.enqueue(chunk)
                else controller.close()
              },
              cancel,
            },
            { highWaterMark: 0 }
          ),
          { headers: { 'content-type': 'text/plain' } }
        )
    )
    const result = await runEmbeddedCli(['files', 'get', 'file'], { ...identity, transport })
    expect(result.exitCode).toBe(1)
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(16 * 1024 * 1024)
    expect(result.stderr).toContain('output limit')
    expect(result.stderr).toContain('Do not repeat a mutation')
    expect(produced).toBeLessThan(24)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('keeps binary downloads off the text result independently of the host terminal', async () => {
    const cancel = vi.fn()
    const result = await runEmbeddedCli(['files', 'get', 'file'], {
      ...identity,
      transport: async () =>
        new Response(new ReadableStream({ cancel }), {
          headers: { 'content-type': 'image/png' },
        }),
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('--output-file')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('keeps overflow sticky if command code catches it and puts its warning before captured stderr', async () => {
    const requests = vi.fn(async () => {
      const block = 'x'.repeat(1024 * 1024)
      try {
        for (let index = 0; index < 17; index++) process.stderr.write(block)
      } catch {
        /** An internal handler can catch a logging failure after a mutation already committed. */
      }
      return Response.json({ data: { id: 'created', name: 'New workflow' } })
    })
    const result = await runEmbeddedCli(['workflows', 'create', '--name', 'New workflow'], {
      ...identity,
      transport: requests,
    })
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout).id).toBe('created')
    expect(result.stderr.split('\n')[0]).toContain('output limit')
    expect(result.stderr.split('\n')[0]).toContain('Do not repeat a mutation')
    expect(Buffer.byteLength(result.stderr)).toBeLessThan(16 * 1024 * 1024 + 1024)
    expect(requests).toHaveBeenCalledTimes(1)
  })

  it('cleans up opened upload snapshots even when API error diagnostics overflow', async () => {
    const dispose = vi.fn(async () => {})
    const result = await runEmbeddedCli(
      ['files', 'upload', 'data.csv'],
      {
        ...identity,
        transport: async () =>
          Response.json({ error: { message: 'x'.repeat(17 * 1024 * 1024) } }, { status: 403 }),
      },
      {
        openFile: async () => ({ size: 1, stream: async () => new Blob(['x']).stream(), dispose }),
      }
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('output limit')
    expect(result.stderr.length).toBeLessThan(1024)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps a simultaneous healthy invocation independent of an overflowing one', async () => {
    const [failed, healthy] = await Promise.all([
      runEmbeddedCli(['files', 'get', 'large'], {
        ...identity,
        transport: async () => download([new Uint8Array(17 * 1024 * 1024)]),
      }),
      runEmbeddedCli(['files', 'get', 'small'], {
        ...identity,
        transport: async () => download([Buffer.from('{"ok":'), Buffer.from('true}')]),
      }),
    ])
    expect(failed.exitCode).toBe(1)
    expect(failed.stdout).toBe('')
    expect(healthy).toEqual({ exitCode: 0, stdout: '{"ok":true}', stderr: '' })
  })

  it('streams a large binary to the workbench without consuming the text capture budget', async () => {
    const block = new Uint8Array(1024 * 1024).fill(128)
    let savedBytes = 0
    const result = await runEmbeddedCli(
      ['files', 'get', 'large', '--output-file', 'large.bin'],
      {
        ...identity,
        transport: async () => download(Array.from({ length: 20 }, () => block)),
      },
      {
        writeFile: async (_path, stream) => {
          const reader = stream.getReader()
          try {
            while (true) {
              const chunk = await reader.read()
              if (chunk.done) break
              savedBytes += chunk.value.byteLength
            }
          } finally {
            reader.releaseLock()
          }
        },
      }
    )
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ path: 'large.bin', status: 'saved' })
    expect(savedBytes).toBe(20 * 1024 * 1024)
  })
})
