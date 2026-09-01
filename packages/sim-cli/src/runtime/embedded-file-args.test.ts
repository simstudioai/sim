import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { embedStore } from '../embed-context'
import { readArgumentSource } from './request'

describe('file arguments in embedded runs', () => {
  it('refuses @path reads in-process when the host preloaded nothing', () => {
    const ctx = {
      identity: { endpoint: 'http://x', apiKey: 'k' },
      stdout: [] as string[],
      stderr: [] as string[],
    }
    embedStore.run(ctx, () => {
      expect(() => readArgumentSource('@/etc/hostname', 'input')).toThrow(
        /no file "\/etc\/hostname" on this machine/
      )
    })
  })

  it('serves @path from host-preloaded file arguments, never local disk', () => {
    const ctx = {
      identity: { endpoint: 'http://x', apiKey: 'k' },
      stdout: [] as string[],
      stderr: [] as string[],
      fileArguments: { 'env.json': '{"thread":"t1"}' },
    }
    embedStore.run(ctx, () => {
      const resolved = readArgumentSource('@env.json', 'input')
      expect(resolved.text).toBe('{"thread":"t1"}')
      expect(resolved.from).toContain('your machine')
      expect(() => readArgumentSource('@other.json', 'input')).toThrow(/no file "other.json"/)
    })
  })

  it('keeps @@ literal escape and inline values working embedded', () => {
    const ctx = {
      identity: { endpoint: 'http://x', apiKey: 'k' },
      stdout: [] as string[],
      stderr: [] as string[],
    }
    embedStore.run(ctx, () => {
      expect(readArgumentSource('@@literal', 'input').text).toBe('@literal')
      expect(readArgumentSource('{"a":1}', 'input').text).toBe('{"a":1}')
    })
  })

  it('still reads files outside embedded runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-args-'))
    const file = join(dir, 'v.json')
    writeFileSync(file, '{"ok":true}')
    expect(readArgumentSource(`@${file}`, 'input').text).toBe('{"ok":true}')
  })
})
