import { EventEmitter } from 'node:events'
import type { ReadStream } from 'node:tty'
import { describe, expect, it } from 'vitest'
import { promptSecret, SecretInputCancelledError } from './secret-input'

const ESCAPE = '\u001b'

class FakeInput extends EventEmitter {
  isTTY = true
  isRaw = false
  readableFlowing: boolean | null = null
  readonly rawStates: boolean[] = []

  isPaused(): boolean {
    return this.readableFlowing === false
  }

  setRawMode(value: boolean): this {
    this.isRaw = value
    this.rawStates.push(value)
    return this
  }

  resume(): this {
    this.readableFlowing = true
    return this
  }

  pause(): this {
    this.readableFlowing = false
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
  it('masks input and pauses an initially idle terminal before returning', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    expect(input.isPaused()).toBe(false)

    const result = promptSecret(input as unknown as ReadStream, output)

    input.emit('keypress', 'hunter2', { name: 'h' })
    input.emit('keypress', '\r', { name: 'return' })

    await expect(result).resolves.toBe('hunter2')
    expect(output.value).toBe('Secret value: *******\n')
    expect(input.rawStates).toEqual([true, false])
    expect(input.isPaused()).toBe(true)
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
    await expect(result).rejects.toBeInstanceOf(SecretInputCancelledError)
    expect(input.rawStates).toEqual([true, false])
    expect(input.isPaused()).toBe(true)
  })

  it('keeps the character following a pasted escape byte', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    const result = promptSecret(input as unknown as ReadStream, output)

    input.emit('keypress', undefined, { name: 'a', meta: true, sequence: `${ESCAPE}a` })
    input.emit('keypress', 'b', { name: 'b' })
    input.emit('keypress', undefined, { name: 'space', meta: true, sequence: `${ESCAPE} ` })
    input.emit('keypress', undefined, { meta: true, sequence: `${ESCAPE}!` })
    input.emit('keypress', undefined, { name: 'a', meta: true, sequence: `${ESCAPE}${ESCAPE}A` })
    input.emit('keypress', '\r', { name: 'return' })

    await expect(result).resolves.toBe('ab !A')
    expect(output.value).toBe('Secret value: *****\n')
  })

  it('still ignores navigation keys and a lone escape', async () => {
    const input = new FakeInput()
    const result = promptSecret(input as unknown as ReadStream, new FakeOutput())

    input.emit('keypress', undefined, { name: 'up', sequence: `${ESCAPE}[A` })
    input.emit('keypress', undefined, { name: 'left', sequence: `${ESCAPE}[D` })
    input.emit('keypress', undefined, { name: 'up', meta: true, sequence: `${ESCAPE}[1;3A` })
    input.emit('keypress', undefined, { name: 'escape', meta: true, sequence: ESCAPE })
    input.emit('keypress', 'x', { name: 'x' })
    input.emit('keypress', 'y', { name: 'y' })
    input.emit('keypress', '\r', { name: 'return' })

    await expect(result).resolves.toBe('xy')
  })
})
