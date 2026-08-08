import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { ReadlineChatTerminal } from './chat-terminal.js'

const ESC = String.fromCharCode(27)

function harness(columns = 60) {
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode?: () => void }
  const output = new PassThrough() as PassThrough & {
    isTTY: boolean
    columns: number
    rows: number
  }
  input.isTTY = true
  input.setRawMode = () => {}
  output.isTTY = true
  output.columns = columns
  output.rows = 30
  output.on('data', () => {})
  const terminal = new ReadlineChatTerminal(input as never, output as never)
  return {
    terminal,
    probe: terminal as never as {
      wrappedBody(width: number): string[]
      panelWidth(): number
      wrapCache: unknown
    },
  }
}

/**
 * The cached path must be byte-identical to wrapping the concatenated body in
 * one pass — otherwise a streamed frame would differ from a repainted one.
 */
describe('incremental transcript wrapping', () => {
  const cases: Array<[string, string[]]> = [
    ['plain lines', ['hello world\n', 'second line\n']],
    ['partial final line', ['complete\n', 'partial without newline']],
    ['long wrapping line', [`${'word '.repeat(40)}\n`]],
    ['styled text', [`${ESC}[1mbold${ESC}[0m plain\n`, `${ESC}[31mred\n`, `still red${ESC}[0m\n`]],
    ['blank lines', ['a\n', '\n', '\n', 'b\n']],
    ['token by token', ['no newline yet', ' more', ' and more', '\n', 'next\n']],
    ['unicode', ['héllo wörld ☃\n', '日本語のテキスト\n']],
  ]

  for (const [name, chunks] of cases) {
    it(`matches a single-pass wrap: ${name}`, () => {
      const { terminal, probe } = harness()
      const oneShot = harness()
      for (const chunk of chunks) {
        terminal.write(chunk)
        oneShot.terminal.write(chunk)
        oneShot.probe.wrapCache = null
        const width = probe.panelWidth()
        expect(probe.wrappedBody(width)).toEqual(oneShot.probe.wrappedBody(width))
      }
      terminal.close()
      oneShot.terminal.close()
    })
  }

  it('rebuilds when the width changes', () => {
    const { terminal, probe } = harness()
    terminal.write(`${'alpha beta '.repeat(20)}\n`)
    const narrow = probe.wrappedBody(40)
    const wide = probe.wrappedBody(100)
    expect(narrow).not.toEqual(wide)
    expect(probe.wrappedBody(40)).toEqual(narrow)
    terminal.close()
  })

  it('stays correct after the transcript is trimmed from the front', () => {
    const { terminal, probe } = harness()
    for (let i = 0; i < 400; i++) terminal.write(`line ${i} ${'x'.repeat(200)}\n`)
    const width = probe.panelWidth()
    const cached = probe.wrappedBody(width)
    probe.wrapCache = null
    expect(cached).toEqual(probe.wrappedBody(width))
    terminal.close()
  })
})
