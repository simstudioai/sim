/**
 * Embedded runs execute in-process on the hosting server: a positional path must read
 * through the host's reader, and a download must go through the host's writer —
 * never the server's own filesystem (the exploration run of 2026-09-02 found
 * `tables import @x.csv` unreadable and `files get -o` landing in the server's cwd).
 */
import { describe, expect, it, vi } from 'vitest'
import { saveToFile } from '../commands/protocol/files-get'
import { type EmbedContext, embedStore } from '../embed-context'
import { EmbeddedOutput } from '../embed-output'
import { localFile } from './local-file'

function embedded(overrides: Partial<EmbedContext> = {}): EmbedContext {
  return {
    identity: { endpoint: 'http://sim.test', apiKey: 'k', workspaceId: 'ws' },
    stdout: new EmbeddedOutput(),
    stderr: new EmbeddedOutput(),
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
})

describe('embedded downloads', () => {
  const body = () => new Blob(['hello']).stream()

  it('never resolves an invalid caller working directory against the server cwd', async () => {
    const cancel = vi.fn()
    const writeFile = vi.fn()
    const source = new ReadableStream<Uint8Array>({ cancel })
    await expect(
      embedStore.run(embedded({ workingDirectory: 'relative', writeFile }), () =>
        saveToFile(source, 'out.zip', false)
      )
    ).rejects.toThrow('must be absolute')
    expect(writeFile).not.toHaveBeenCalled()
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
})
