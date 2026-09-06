import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { embedStore } from '../embed-context'
import { EmbeddedOutput } from '../embed-output'
import { readArgumentSource } from './request'

describe('file arguments in embedded runs', () => {
  it('keeps a workbench read outage distinct from a missing file without interpreting literal text', async () => {
    await embedStore.run(
      {
        identity: { endpoint: 'http://x', apiKey: 'k' },
        stdout: new EmbeddedOutput(),
        stderr: new EmbeddedOutput(),
        readFile: async () => {
          throw new Error('Workbench unavailable')
        },
      },
      async () => {
        await expect(readArgumentSource('@data.json', 'input')).rejects.toThrow(
          'Workbench unavailable'
        )
        expect((await readArgumentSource('@@data.json', 'input')).text).toBe('@data.json')
      }
    )
  })
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

  it('keeps @@ literal escape and inline values working embedded', async () => {
    const ctx = {
      identity: { endpoint: 'http://x', apiKey: 'k' },
      stdout: new EmbeddedOutput(),
      stderr: new EmbeddedOutput(),
    }
    await embedStore.run(ctx, async () => {
      expect((await readArgumentSource('@@literal', 'input')).text).toBe('@literal')
      expect((await readArgumentSource('{"a":1}', 'input')).text).toBe('{"a":1}')
    })
  })

  it('still reads files outside embedded runs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-args-'))
    const file = join(dir, 'v.json')
    writeFileSync(file, '{"ok":true}')
    expect((await readArgumentSource(`@${file}`, 'input')).text).toBe('{"ok":true}')
  })
})
