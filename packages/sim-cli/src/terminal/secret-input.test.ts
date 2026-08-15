import { EventEmitter } from 'node:events'
import type { ReadStream } from 'node:tty'
import { describe, expect, it } from 'vitest'
import { promptSecret } from './secret-input'

class FakeInput extends EventEmitter {
  isTTY = true
  isRaw = false
  paused = true
  readonly rawStates: boolean[] = []

  isPaused(): boolean {
    return this.paused
  }

  setRawMode(value: boolean): this {
    this.isRaw = value
    this.rawStates.push(value)
    return this
  }

  resume(): this {
    this.paused = false
    return this
  }

  pause(): this {
    this.paused = true
    return this
  }
}

class FakeOutput {
  value = ''

  write(value: string): boolean {
    this.value += value
    return true
  }
}

describe('promptSecret', () => {
  it('masks input and restores the terminal before returning it', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    const result = promptSecret(input as unknown as ReadStream, output)

    input.emit('keypress', 'hunter2', { name: 'h' })
    input.emit('keypress', '\r', { name: 'return' })

    await expect(result).resolves.toBe('hunter2')
    expect(output.value).toBe('Secret value: *******\n')
    expect(input.rawStates).toEqual([true, false])
    expect(input.paused).toBe(true)
  })

  it('handles backspace without revealing the value', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    const result = promptSecret(input as unknown as ReadStream, output)

    input.emit('keypress', 'ab', { name: 'a' })
    input.emit('keypress', '', { name: 'backspace' })
    input.emit('keypress', 'c', { name: 'c' })
    input.emit('keypress', '\r', { name: 'return' })

    await expect(result).resolves.toBe('ac')
    expect(output.value).toBe('Secret value: **\b \b*\n')
  })

  it('requires --value when no interactive terminal is available', () => {
    const input = new FakeInput()
    input.isTTY = false

    expect(() => promptSecret(input as unknown as ReadStream, new FakeOutput())).toThrow(
      'Interactive secret input requires a terminal. Pass --value instead.'
    )
  })

  it('restores the terminal when input is cancelled', async () => {
    const input = new FakeInput()
    const result = promptSecret(input as unknown as ReadStream, new FakeOutput())

    input.emit('keypress', '\u0003', { ctrl: true, name: 'c' })

    await expect(result).rejects.toThrow('Secret input cancelled.')
    expect(input.rawStates).toEqual([true, false])
  })
})
