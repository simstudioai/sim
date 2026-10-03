import { describe, expect, it } from 'vitest'
import { embedStore } from '../embed-context'
import { EmbeddedOutput } from '../embed-output'
import { readArgumentSource } from './request'

describe('file arguments in embedded runs', () => {
  it('refuses @path reads in-process when the host provides no reader', async () => {
    const ctx = {
      identity: { endpoint: 'http://x', apiKey: 'k' },
      stdout: new EmbeddedOutput(),
      stderr: new EmbeddedOutput(),
    }
    await embedStore.run(ctx, async () => {
      await expect(readArgumentSource('@/etc/hostname', 'input')).rejects.toThrow(
        /no machine to read from/
      )
    })
  })

  it('serves @path through the host reader, never local disk', async () => {
    const ctx = {
      identity: { endpoint: 'http://x', apiKey: 'k' },
      stdout: new EmbeddedOutput(),
      stderr: new EmbeddedOutput(),
      readFile: async (path: string) => {
        if (path === 'env.json') return '{"thread":"t1"}'
        throw new Error(`no file "${path}"`)
      },
    }
    await embedStore.run(ctx, async () => {
      const resolved = await readArgumentSource('@env.json', 'input')
      expect(resolved.text).toBe('{"thread":"t1"}')
      expect(resolved.from).toContain('your machine')
      await expect(readArgumentSource('@other.json', 'input')).rejects.toThrow(
        /no file "other.json"/
      )
    })
  })
})
