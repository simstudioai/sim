/**
 * Embedded runs execute in-process on the hosting server: a positional path must read
 * from the host's pre-read map, and a download must go through the host's writer —
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
  it('reads @path and bare path from the pre-read map, never the server disk', async () => {
    const ctx = embedded({ fileArguments: { 'xp_import.csv': 'a,b\n1,2\n' } })
    await embedStore.run(ctx, async () => {
      expect(await localFile('@xp_import.csv')).toEqual({ name: 'xp_import.csv', size: 8 })
      expect(await localFile('xp_import.csv', 'renamed.csv')).toEqual({
        name: 'renamed.csv',
        size: 8,
      })
    })
  })

  it('refuses a path the host did not pre-read, telling the caller how to provide it', async () => {
    await embedStore.run(embedded(), async () => {
      await expect(localFile('@missing.csv')).rejects.toThrow('use @missing.csv')
    })
  })
})

describe('embedded downloads', () => {
  const body = () => new Blob(['hello']).stream()

  it('writes through the host writer instead of the server filesystem', async () => {
    const writeFile = vi.fn(async () => true)
    await embedStore.run(embedded({ writeFile }), async () => {
      await saveToFile(body(), 'out.txt', false)
    })
    expect(writeFile).toHaveBeenCalledTimes(1)
    const [path, bytes] = writeFile.mock.calls[0] as unknown as [string, Uint8Array]
    expect(path).toBe('out.txt')
    expect(new TextDecoder().decode(bytes)).toBe('hello')
  })

  it('refuses when the host has no writer or the machine is not running', async () => {
    await embedStore.run(embedded(), async () => {
      await expect(saveToFile(body(), 'out.txt', false)).rejects.toThrow('no machine to write to')
    })
    await embedStore.run(embedded({ writeFile: async () => false }), async () => {
      await expect(saveToFile(body(), 'out.txt', false)).rejects.toThrow('workbench is not running')
    })
  })
})
