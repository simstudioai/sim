import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { ReadlineChatTerminal } from './chat-terminal.js'

const ESC = String.fromCharCode(27)
const TAG = `${ESC}[38;2;51;196;130m`

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
  output.on('data', () => {})
  const terminal = new ReadlineChatTerminal(input as never, output as never)
  const probe = terminal as never as {
    draft: string
    buildPanel(rows: number): { lines: string[] }
  }
  return {
    input,
    terminal,
    draft: () => probe.draft,
    row: () => probe.buildPanel(20).lines.join('\n'),
  }
}

describe('pasted image tag', () => {
  it('inserts a numbered tag at the cursor and highlights it', () => {
    const { input, terminal, draft, row } = harness()
    void terminal.read('> ')
    input.write('look at')
    terminal.noteAttachment()
    expect(draft()).toBe('look at [Image #1] ')
    expect(row()).toContain(`${TAG}[Image #1]`)
    terminal.close()
  })

  it('numbers successive attachments', () => {
    const { terminal, draft } = harness()
    void terminal.read('> ')
    terminal.noteAttachment()
    terminal.noteAttachment()
    expect(draft()).toBe('[Image #1] [Image #2] ')
    terminal.close()
  })

  it('stops highlighting once the tag is deleted', () => {
    const { input, terminal, row } = harness()
    void terminal.read('> ')
    terminal.noteAttachment()
    expect(row()).toContain(TAG)
    const BACKSPACE = String.fromCharCode(127)
    for (let i = 0; i < 12; i++) input.write(BACKSPACE)
    expect(row()).not.toContain(TAG)
    terminal.close()
  })
})
