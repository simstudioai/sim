import { describe, expect, it } from 'vitest'
import { isChangelogMediaSource } from '@/lib/changelog/media'

describe('changelog media origins', () => {
  it.each([
    { kind: 'tab padding', source: '/\t/example.test/demo.mp4' },
    { kind: 'newline padding', source: '/\n//example.test/demo.mp4' },
    { kind: 'carriage-return padding', source: '/\r/example.test/demo.mp4' },
    { kind: 'backslash separators', source: '/\\example.test/demo.mp4' },
  ])('rejects $kind that browsers resolve to another origin', ({ source }) => {
    expect(new URL(source, 'https://www.sim.ai').origin).toBe('https://example.test')
    expect(isChangelogMediaSource(source)).toBe(false)
  })
})
