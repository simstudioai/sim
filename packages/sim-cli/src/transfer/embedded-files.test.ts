/**
 * Embedded runs execute in-process on the hosting server: a positional path must read
 * through the host's reader, and a download must go through the host's writer —
 * never the server's own filesystem (the exploration run of 2026-09-02 found
 * `tables import @x.csv` unreadable and `files get -o` landing in the server's cwd).
 */
import { describe, expect, it, vi } from 'vitest'
import { saveToFile } from '../commands/protocol/files-get'
import { type EmbedContext, embedStore } from '../embed-context'
import { localFile } from './local-file'

function embedded(overrides: Partial<EmbedContext> = {}): EmbedContext {
  return {
    identity: { endpoint: 'http://sim.test', apiKey: 'k', workspaceId: 'ws' },
    stdout: [],
    stderr: [],
    ...overrides,
  }
}

describe('embedded positional file arguments', () => {
  it('reads @path and bare path through the host, never the server disk', async () => {
    const ctx = embedded({
      openFile: async (path) => {
        expect(path).toBe('xp_import.csv')
        return {
          size: 8,
          stream: async () => new Blob(['a,b\n1,2\n']).stream(),
          dispose: async () => {},
        }
      },
    })
    await embedStore.run(ctx, async () => {
      expect(await localFile('@xp_import.csv')).toEqual({ name: 'xp_import.csv', size: 8 })
      expect(await localFile('xp_import.csv', 'renamed.csv')).toEqual({
        name: 'renamed.csv',
        size: 8,
      })
    })
  })

  it('refuses a path when the host has no reader', async () => {
    await embedStore.run(embedded(), async () => {
      await expect(localFile('@missing.csv')).rejects.toThrow('no machine to read from')
    })
  })
})

describe('embedded downloads', () => {
  const body = () => new Blob(['hello']).stream()

  it('hands the host the stream before consuming the download', async () => {
    let produced = 0
    const source = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          produced++
          if (produced <= 8) controller.enqueue(new Uint8Array(1024 * 1024))
          else controller.close()
        },
      },
      { highWaterMark: 0 }
    )
    await embedStore.run(
      embedded({
        writeFile: async (_path, content) => {
          expect(produced).toBe(0)
          expect(content).toBe(source)
          expect((await new Response(content).arrayBuffer()).byteLength).toBe(8 * 1024 * 1024)
        },
      }),
      () => saveToFile(source, 'large.csv', false)
    )
  })

  it('cancels an unconsumed download when the host cannot save it', async () => {
    const cancel = vi.fn()
    const source = new ReadableStream<Uint8Array>({ cancel })
    await embedStore.run(embedded(), async () => {
      await expect(saveToFile(source, 'out.txt', false)).rejects.toThrow('no machine to write to')
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('writes through the host writer instead of the server filesystem', async () => {
    const contents: string[] = []
    const writeFile = vi.fn(
      async (
        _path: string,
        stream: ReadableStream<Uint8Array>,
        _options: { overwrite: boolean }
      ) => {
        contents.push(await new Response(stream).text())
      }
    )
    await embedStore.run(embedded({ writeFile }), async () => {
      await saveToFile(body(), 'out.txt', false)
    })
    expect(writeFile).toHaveBeenCalledTimes(1)
    const [path, stream, options] = writeFile.mock.calls[0]!
    expect(path).toBe('out.txt')
    expect(stream).toBeInstanceOf(ReadableStream)
    expect(contents).toEqual(['hello'])
    expect(options).toEqual({ overwrite: false })
    await embedStore.run(embedded({ writeFile }), async () => {
      await saveToFile(body(), 'out.txt', true)
    })
    expect(writeFile.mock.calls[1]?.[2]).toEqual({ overwrite: true })
  })

  it('refuses when the host has no writer or cannot confirm the write', async () => {
    await embedStore.run(embedded(), async () => {
      await expect(saveToFile(body(), 'out.txt', false)).rejects.toThrow('no machine to write to')
    })
    await embedStore.run(
      embedded({
        writeFile: async () => {
          throw new Error('could not be confirmed')
        },
      }),
      async () => {
        await expect(saveToFile(body(), 'out.txt', false)).rejects.toThrow('could not be confirmed')
      }
    )
  })
})
