import { sleep } from '@sim/utils/helpers'
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
  await sleep(30)
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

describe('replaying retained bytes into a fresh emulator', () => {
  /**
   * The screen is now rendered by replaying the retained byte stream into an
   * emulator built for the read, rather than keeping one fed forever. Two
   * things have to hold for that to be equivalent.
   */
  it('has the whole stream parsed by the time the write callback fires', async () => {
    // xterm parses asynchronously in 12ms slices, so reading the buffer right
    // after write() would catch it half-parsed. The callback is the signal.
    const term = new Terminal({ cols: 40, rows: 8, allowProposedApi: true })
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`)

    await new Promise<void>((resolve) => term.write(`${lines.join('\r\n')}\r\n`, resolve))

    const buffer = term.buffer.active
    const rendered: string[] = []
    for (let row = 0; row < buffer.length; row++) {
      const text = buffer.getLine(row)?.translateToString(true) ?? ''
      if (text.trim()) rendered.push(text.trim())
    }
    expect(rendered.at(-1)).toBe('line 199')
    expect(rendered).toHaveLength(200)
  })

  it('reconstructs the final screen of a program that redraws in place', async () => {
    // A TUI overwrites the same rows, so a replay must end on the last frame
    // rather than showing every frame stacked up — the reason a raw byte dump
    // cannot be handed to the model directly.
    const term = new Terminal({ cols: 40, rows: 8, allowProposedApi: true })
    const frames = ['Loading   ', 'Loading.  ', 'Loading.. ', 'Done!     ']
    const stream = frames.map((frame) => `\u001b[H\u001b[2K${frame}`).join('')

    await new Promise<void>((resolve) => term.write(stream, resolve))

    const firstRow = term.buffer.active.getLine(0)?.translateToString(true).trim()
    expect(firstRow).toBe('Done!')
  })
})
