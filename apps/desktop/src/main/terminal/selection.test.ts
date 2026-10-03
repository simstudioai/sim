import { Terminal } from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import { findSelectedRow } from '@/main/terminal/session'

const REVERSE = '\u001b[7m'
const RESET = '\u001b[0m'

/**
 * Writes to a real headless emulator and waits for the queued writes to finish,
 * so these exercise the same buffer the agent reads. The trailing empty write's
 * callback fires after xterm has parsed every preceding chunk.
 */
async function screen(write: (term: Terminal) => void, rows = 8): Promise<Terminal> {
  const term = new Terminal({ cols: 40, rows, allowProposedApi: true })
  write(term)
  await new Promise<void>((resolve) => term.write('', resolve))
  return term
}

/** A row painted end to end, the way a TUI marks the current item. */
function painted(text: string): string {
  return `${REVERSE}${text.padEnd(40)}${RESET}`
}

describe('findSelectedRow', () => {
  it('is not fooled by a few coloured words in output', async () => {
    const term = await screen((t) => {
      t.write(`\u001b[31mERROR\u001b[0m something went wrong\r\n`)
      t.write(`\u001b[32mPASS\u001b[0m all good\r\n`)
    })

    expect(findSelectedRow(term.buffer.active)).toBeNull()
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
