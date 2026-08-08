import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { ReadlineChatTerminal } from './chat-terminal.js'

const ESC = String.fromCharCode(27)
const MENTION = `${ESC}[38;2;51;196;130m`
const BODY_TEXT = `${ESC}[38;2;242;242;242m`
const BACKSPACE = String.fromCharCode(127)

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
  terminal.setSuggestionCandidates({
    resources: [
      {
        id: 'w1',
        value: 'code-review',
        displayText: 'code-review',
        tag: 'workflow',
        context: {
          kind: 'workflow',
          workflowId: 'w1',
          label: 'code-review',
        },
      },
      {
        id: 'w2',
        value: 'release notes',
        displayText: 'release notes',
        tag: 'workflow',
        context: {
          kind: 'workflow',
          workflowId: 'w2',
          label: 'release notes',
        },
      },
    ],
    slash: [
      {
        id: 's1',
        value: 'review',
        displayText: '/review',
        tag: 'skill',
        context: { kind: 'skill', skillId: 's1', label: 'review' },
      },
    ],
  })
  const probe = terminal as never as { buildPanel(rows: number): { lines: string[] } }
  return {
    input,
    terminal,
    draftRow: () => probe.buildPanel(20).lines.find((line) => line.includes('>')) ?? '',
  }
}

describe('mention highlighting', () => {
  it('lights a mention that resolves to a candidate', () => {
    const { input, terminal, draftRow } = harness()
    void terminal.read('> ')
    input.write('run @code\tnow')
    expect(draftRow()).toContain(`${MENTION}@code-review${BODY_TEXT}`)
    terminal.close()
  })

  it('goes plain once the mention is half-deleted', () => {
    const { input, terminal, draftRow } = harness()
    void terminal.read('> ')
    input.write('run @code\t')
    expect(draftRow()).toContain(MENTION)
    for (let i = 0; i < 3; i++) input.write(BACKSPACE)
    expect(draftRow()).not.toContain(MENTION)
    terminal.close()
  })

  it('does not light an unknown mention or an email address', () => {
    const { input, terminal, draftRow } = harness()
    void terminal.read('> ')
    input.write('ping @nobody and me@example.com')
    expect(draftRow()).not.toContain(MENTION)
    terminal.close()
  })

  it('lights the client-style literal mention containing a space', () => {
    const { input, terminal, draftRow } = harness()
    void terminal.read('> ')
    input.write('draft @release\tplease')
    expect(draftRow()).toContain(`${MENTION}@release notes${BODY_TEXT}`)
    terminal.close()
  })

  it('lights a typed exact slash skill once it resolves', () => {
    const { input, terminal, draftRow } = harness()
    void terminal.read('> ')
    input.write('use /review now')
    expect(draftRow()).toContain(`${MENTION}/review${BODY_TEXT}`)
    terminal.close()
  })

  it('closes the style at a row break so it cannot leak', () => {
    const { input, terminal } = harness()
    void terminal.read('> ')
    input.write(`${'x'.repeat(75)} @code\ttail`)
    const probe = terminal as never as { buildPanel(rows: number): { lines: string[] } }
    for (const line of probe.buildPanel(20).lines) {
      const opens = line.split(MENTION).length - 1
      const closes = line.split(`${ESC}[0m`).length - 1
      expect(closes).toBeGreaterThanOrEqual(opens)
    }
    terminal.close()
  })
})
