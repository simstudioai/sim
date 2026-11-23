import chalk from 'chalk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasProgressTerminal, styles } from './presentation'

beforeEach(() => {
  vi.stubEnv('FORCE_COLOR', undefined)
  vi.stubEnv('NO_COLOR', undefined)
  vi.stubEnv('TERM', 'xterm-256color')
})

describe('styles', () => {
  it.each([
    { name: 'a non-empty NO_COLOR', env: { NO_COLOR: '1' } },
    { name: 'a NO_COLOR whose value is 0', env: { NO_COLOR: '0' } },
    { name: 'a dumb terminal', env: { TERM: 'dumb' } },
  ])('uses plain styling under $name', ({ env }) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)

    expect(styles()).not.toBe(chalk)
    expect(styles().level).toBe(0)
  })

  it('keeps chalk when NO_COLOR is empty', () => {
    vi.stubEnv('NO_COLOR', '')

    expect(styles()).toBe(chalk)
  })

  it('keeps chalk when FORCE_COLOR is set, as Node does', () => {
    vi.stubEnv('NO_COLOR', '1')
    vi.stubEnv('FORCE_COLOR', '1')

    expect(styles()).toBe(chalk)
  })
})

describe('hasProgressTerminal', () => {
  it('is false on a dumb terminal even when stderr is a TTY', () => {
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true })
    try {
      expect(hasProgressTerminal()).toBe(true)

      vi.stubEnv('TERM', 'dumb')
      expect(hasProgressTerminal()).toBe(false)
    } finally {
      Reflect.deleteProperty(process.stderr, 'isTTY')
    }
  })
})
