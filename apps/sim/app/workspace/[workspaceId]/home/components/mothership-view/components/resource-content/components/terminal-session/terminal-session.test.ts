/**
 * @vitest-environment jsdom
 */

import { resolveDesktopZoom } from '@sim/desktop-bridge'
import { describe, expect, it } from 'vitest'
import {
  shouldRemoveTerminalResource,
  terminalFontSizeForZoom,
  terminalSelectionLabel,
  terminalSelectionSnapshot,
  terminalTooltip,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/terminal-session/terminal-session'

describe('terminal tab tooltips', () => {
  it('summarizes a long compound heredoc command by its foreground program', () => {
    const running = `mkdir -p ~/.doordash-bot/bin && cat > ~/.doordash-bot/bin/dd-cli-mock <<'EOF'
#!/usr/bin/env node
const carts = new Map()
process.stdout.write(JSON.stringify([...carts]))
EOF
chmod +x ~/.doordash-bot/bin/dd-cli-mock && echo '--- smoke test ---' && ~/.doordash-bot/bin/dd-cli-mock submit mock_123`
    const tooltip = terminalTooltip({
      terminalId: 'terminal-1',
      title: 'mkdir',
      cwd: '/Users/emirkarabeg',
      running,
      interactive: false,
      active: false,
    })

    expect(tooltip).toBe('/Users/emirkarabeg — dd-cli-mock')
    expect(tooltip).not.toContain('const carts')
  })

  it('preserves the working-directory tooltip for idle terminals', () => {
    const idleTab = {
      terminalId: 'terminal-1',
      title: 'sim',
      cwd: '/Users/emirkarabeg/sim',
      running: null,
      interactive: false,
      active: true,
    }

    expect(terminalTooltip(idleTab)).toBe('/Users/emirkarabeg/sim')
    expect(terminalTooltip({ ...idleTab, cwd: null })).toBe('Terminal')
  })
})

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

describe('terminal resource zoom', () => {
  it('scales xterm from its 12px actual size', () => {
    expect(terminalFontSizeForZoom(100)).toBe(12)
    expect(terminalFontSizeForZoom(125)).toBe(15)
  })

  it('uses the shared zoom ladder and resets to the configured baseline', () => {
    const bounds = { min: 50, max: 300 }

    expect(resolveDesktopZoom(100, 'in', 125, bounds)).toBeCloseTo(110)
    expect(resolveDesktopZoom(100, 'out', 125, bounds)).toBeCloseTo(100 / 1.1)
    expect(resolveDesktopZoom(180, 'reset', 125, bounds)).toBe(125)
    expect(resolveDesktopZoom(300, 'in', 125, bounds)).toBe(300)
  })
})

describe('terminal selection snapshots', () => {
  it('converts xterm buffer rows to one-based chat metadata', () => {
    expect(
      terminalSelectionSnapshot('selected', {
        start: { x: 3, y: 4 },
        end: { x: 11, y: 6 },
      })
    ).toEqual({ text: 'selected', startLine: 5, endLine: 7 })
  })

  it('does not include the exclusive next row when a selection ends at column zero', () => {
    expect(
      terminalSelectionSnapshot('first line\n', {
        start: { x: 0, y: 8 },
        end: { x: 0, y: 9 },
      })
    ).toEqual({ text: 'first line\n', startLine: 9, endLine: 9 })
  })

  it('returns no snapshot without selected text or a position', () => {
    expect(terminalSelectionSnapshot('', undefined)).toBeNull()
  })

  it('labels single and multiline selections for the visible chat chip', () => {
    expect(terminalSelectionLabel({ text: 'one', startLine: 9, endLine: 9 })).toBe('Terminal (L9)')
    expect(terminalSelectionLabel({ text: 'several', startLine: 9, endLine: 11 })).toBe(
      'Terminal (L9-11)'
    )
  })
})
