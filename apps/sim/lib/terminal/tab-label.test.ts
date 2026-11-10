import type { TerminalTabState } from '@sim/terminal-protocol'
import { describe, expect, it } from 'vitest'
import { terminalTabTitle } from '@/lib/terminal/tab-label'

const idleTab: TerminalTabState = {
  terminalId: 'terminal-1',
  title: 'sim',
  cwd: '/Users/ada/sim',
  running: null,
  interactive: false,
  active: true,
}

describe('terminalTabTitle', () => {
  it('names an idle shell after its directory', () => {
    expect(terminalTabTitle(idleTab, new Set())).toBe('sim')
  })

  it('names a shell after a command only once it has settled', () => {
    const building = { ...idleTab, running: 'bun run build' }
    expect(terminalTabTitle(building, new Set())).toBe('sim')
    expect(terminalTabTitle(building, new Set(['terminal-1']))).toBe('bun run build')
  })

  it('names a full-screen program immediately', () => {
    expect(terminalTabTitle({ ...idleTab, running: 'vim', interactive: true }, new Set())).toBe(
      'vim'
    )
  })
})
