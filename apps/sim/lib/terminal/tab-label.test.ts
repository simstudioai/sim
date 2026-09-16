/**
 * @vitest-environment node
 */
import type { TerminalTabState } from '@sim/terminal-protocol'
import { describe, expect, it } from 'vitest'
import { terminalTabTitle, terminalTooltip } from '@/lib/terminal/tab-label'

const idleTab: TerminalTabState = {
  terminalId: 'terminal-1',
  title: 'sim',
  cwd: '/Users/ada/sim',
  running: null,
  interactive: false,
  active: true,
}

describe('terminalTooltip', () => {
  it('summarizes a long compound heredoc command by its foreground program', () => {
    const running = `mkdir -p ~/.bot/bin && cat > ~/.bot/bin/cli-mock <<'END'
#!/usr/bin/env node
const carts = new Map()
process.stdout.write(JSON.stringify([...carts]))
END
chmod +x ~/.bot/bin/cli-mock && echo '--- smoke test ---' && ~/.bot/bin/cli-mock submit mock_123`
    const tooltip = terminalTooltip({ ...idleTab, title: 'mkdir', cwd: '/Users/ada', running })

    expect(tooltip).toBe('/Users/ada — cli-mock')
    expect(tooltip).not.toContain('const carts')
  })

  it('preserves the working-directory tooltip for idle terminals', () => {
    expect(terminalTooltip(idleTab)).toBe('/Users/ada/sim')
    expect(terminalTooltip({ ...idleTab, cwd: null })).toBe('Terminal')
  })
})

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
