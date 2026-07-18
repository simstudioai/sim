import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEventLog, scrubUrl } from '@/main/observability'

describe('scrubUrl', () => {
  it('drops query strings and fragments so tokens never reach the log', () => {
    expect(scrubUrl('https://sim.ai/desktop/auth?state=SECRET&token=SECRET#frag')).toBe(
      'https://sim.ai/desktop/auth'
    )
  })

  it('returns empty for unparseable input', () => {
    expect(scrubUrl('not a url')).toBe('')
  })
})

describe('createEventLog', () => {
  it('appends JSONL entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-desktop-events-'))
    const events = createEventLog(dir)
    events.record('app_launch', { version: '1.0.0' })
    events.record('load_failure', { kind: 'dns' })

    const lines = readFileSync(events.filePath, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0])
    expect(first.name).toBe('app_launch')
    expect(first.data).toEqual({ version: '1.0.0' })
    expect(typeof first.at).toBe('string')
  })

  it('rotates once past the size cap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-desktop-events-'))
    const events = createEventLog(dir, 64)
    events.record('app_launch', { version: '1.0.0' })
    events.record('app_launch', { version: '1.0.0' })
    events.record('app_launch', { version: '1.0.0' })
    expect(existsSync(`${events.filePath}.1`)).toBe(true)
  })
})
