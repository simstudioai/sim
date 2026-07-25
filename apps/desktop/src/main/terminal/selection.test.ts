import { Terminal } from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import { findSelectedRow } from '@/main/terminal/session'

const REVERSE = '\u001b[7m'
const RESET = '\u001b[0m'

/**
 * Writes to a real headless emulator and lets it settle, so these exercise the
 * same buffer the agent reads rather than a hand-built fake. xterm parses
 * asynchronously, hence the flush.
 */
async function screen(write: (term: Terminal) => void, rows = 8): Promise<Terminal> {
  const term = new Terminal({ cols: 40, rows, allowProposedApi: true })
  write(term)
  await new Promise((resolve) => setTimeout(resolve, 30))
  return term
}

/** A row painted end to end, the way a TUI marks the current item. */
function painted(text: string): string {
  return `${REVERSE}${text.padEnd(40)}${RESET}`
}

describe('findSelectedRow', () => {
  it('finds the row a menu has highlighted', async () => {
    const term = await screen((t) => {
      t.write('Pick one:\r\n')
      t.write('  alpha\r\n')
      t.write(`${painted('> bravo')}\r\n`)
      t.write('  charlie\r\n')
    })

    const row = findSelectedRow(term.buffer.active)

    expect(row).not.toBeNull()
    expect(
      term.buffer.active
        .getLine(row as number)
        ?.translateToString(true)
        .trim()
    ).toBe('> bravo')
  })

  it('marks nothing on an ordinary screen', async () => {
    // Plain command output must never come back with a row labelled selected.
    const term = await screen((t) => {
      t.write('total 24\r\ndrwxr-xr-x  src\r\n-rw-r--r--  package.json\r\n')
    })

    expect(findSelectedRow(term.buffer.active)).toBeNull()
  })

  it('is not fooled by a few coloured words in output', async () => {
    const term = await screen((t) => {
      t.write(`\u001b[31mERROR\u001b[0m something went wrong\r\n`)
      t.write(`\u001b[32mPASS\u001b[0m all good\r\n`)
    })

    expect(findSelectedRow(term.buffer.active)).toBeNull()
  })

  it('prefers a menu row over a status bar painted at the bottom', async () => {
    // tmux, vim and htop all paint a full-width bar at an edge; taking that as
    // the selection would point the agent at the wrong row entirely.
    const term = await screen((t) => {
      t.write('  alpha\r\n')
      t.write(`${painted('> bravo')}\r\n`)
      t.write('  charlie\r\n')
      t.write('\u001b[8;1H')
      t.write(painted('[0] 0:zsh*  "host"  12:00'))
    })

    const row = findSelectedRow(term.buffer.active)

    expect(
      term.buffer.active
        .getLine(row as number)
        ?.translateToString(true)
        .trim()
    ).toBe('> bravo')
  })

  it('marks nothing rather than guessing between several painted rows', async () => {
    // A wrong label sends the agent somewhere it did not intend to go, which
    // is worse than it having to look for itself.
    const term = await screen((t) => {
      t.write(`${painted('one')}\r\n`)
      t.write(`${painted('two')}\r\n`)
      t.write(`${painted('three')}\r\n`)
      t.write('plain\r\n')
    })

    expect(findSelectedRow(term.buffer.active)).toBeNull()
  })
})
