import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { ReadlineChatTerminal } from './chat-terminal.js'

const ESC = String.fromCharCode(27)
const PASTE_START = `${ESC}[200~`
const PASTE_END = `${ESC}[201~`

function harness() {
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode?: () => void }
  const output = new PassThrough() as PassThrough & {
    isTTY: boolean
    columns: number
    rows: number
  }
  input.isTTY = true
  input.setRawMode = () => {}
  output.isTTY = true
  output.columns = 80
  output.rows = 20
  const terminal = new ReadlineChatTerminal(input as never, output as never)
  return { input, terminal, draft: () => (terminal as never as { draft: string }).draft }
}

describe('bracketed paste', () => {
  it('inserts a short single-line paste literally', () => {
    const { input, terminal, draft } = harness()
    void terminal.read('> ')
    input.write(`${PASTE_START}hello world${PASTE_END}`)
    expect(draft()).toBe('hello world')
    terminal.close()
  })

  it('collapses a multi-line paste to a placeholder and expands it on submit', async () => {
    const { input, terminal, draft } = harness()
    const result = terminal.read('> ')
    const body = 'line one\nline two\nline three\nline four'
    input.write(`${PASTE_START}${body}${PASTE_END}`)
    expect(draft()).toBe('[Pasted text #1 +3 lines]')
    input.write('\r')
    await expect(result).resolves.toEqual({
      kind: 'line',
      value: body,
      display: '[Pasted text #1 +3 lines]',
      pastes: new Map([[1, body]]),
    })
    terminal.close()
  })

  it('collapses a long single-line paste', () => {
    const { input, terminal, draft } = harness()
    void terminal.read('> ')
    input.write(`${PASTE_START}${'x'.repeat(900)}${PASTE_END}`)
    expect(draft()).toBe('[Pasted text #1]')
    terminal.close()
  })

  it('drops a stashed body when its placeholder is deleted', async () => {
    const { input, terminal, draft } = harness()
    const result = terminal.read('> ')
    input.write(`${PASTE_START}a\nb\nc\nd${PASTE_END}`)
    const BACKSPACE = String.fromCharCode(127)
    let guard = 200
    while (draft().length > 0 && guard-- > 0) input.write(BACKSPACE)
    input.write('plain')
    input.write('\r')
    await expect(result).resolves.toEqual({ kind: 'line', value: 'plain' })
    terminal.close()
  })

  it('routes an empty paste to the clipboard, for macOS cmd+v of an image', async () => {
    const { input, terminal } = harness()
    const result = terminal.read('> ')
    input.write(`${PASTE_START}${PASTE_END}`)
    await expect(result).resolves.toEqual({ kind: 'clipboard', value: '' })
    terminal.close()
  })
})
