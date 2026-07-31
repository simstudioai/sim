/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { shouldRemoveTerminalResource } from './terminal-session'

describe('suspended terminal resource lifecycle', () => {
  it('does not remove a resource when administrative suspension clears its PTYs', () => {
    expect(shouldRemoveTerminalResource(0, true, true)).toBe(false)
    expect(shouldRemoveTerminalResource(0, true, false)).toBe(true)
  })

  it('keeps resources that never observed a live PTY', () => {
    expect(shouldRemoveTerminalResource(0, false, false)).toBe(false)
    expect(shouldRemoveTerminalResource(1, true, false)).toBe(false)
  })
})
