import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { embedStore } from '../embed-context'
import { readArgumentSource } from './request'

describe('file arguments in embedded runs', () => {
  it('refuses @path reads in-process, with inline guidance', () => {
    const ctx = {
      identity: { endpoint: 'http://x', apiKey: 'k' },
      stdout: [] as string[],
      stderr: [] as string[],
    }
    embedStore.run(ctx, () => {
      expect(() => readArgumentSource('@/etc/hostname', 'input')).toThrow(
        /not available in embedded runs.*inline/
      )
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
