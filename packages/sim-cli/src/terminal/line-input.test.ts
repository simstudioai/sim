import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { askLine } from './line-input'

/** A terminal's stdin, so readline reads keys (Ctrl-C, Ctrl-D) rather than plain text. */
function terminalInput(): PassThrough {
  const input = new PassThrough()
  Object.assign(input, { isTTY: true, setRawMode: () => input })
  return input
}

let input: PassThrough

beforeEach(() => {
  input = terminalInput()
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(input as unknown as typeof process.stdin)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true })
})

afterEach(() => {
  Object.defineProperty(process.stderr, 'isTTY', { value: undefined, configurable: true })
})

describe('askLine', () => {
  it('resolves the line typed', async () => {
    const answer = askLine('Name? ')
    input.write('sim\r')
    await expect(answer).resolves.toBe('sim')
  })

  it('cancels with the interrupt status 130 at Ctrl-C', async () => {
    const answer = askLine('Name? ')
    input.write('\u0003')
    await expect(answer).rejects.toMatchObject({ code: 'CANCELLED', exitCode: 130 })
  })

  it('resolves null at Ctrl-D, for the caller to cancel as it chooses', async () => {
    const answer = askLine('Name? ')
    input.write('\u0004')
    await expect(answer).resolves.toBeNull()
  })
})
