import { emitKeypressEvents, type Key } from 'node:readline'
import type { ReadStream } from 'node:tty'
import { SimApiError } from '../http/client'

const MAX_SECRET_LENGTH = 65_536

interface SecretOutput {
  write(value: string): unknown
}

/** Reads a secret from a TTY while rendering one mask character per entered character. */
export function promptSecret(
  input: ReadStream = process.stdin,
  output: SecretOutput = process.stderr
): Promise<string> {
  if (!input.isTTY) {
    throw new SimApiError('Interactive secret input requires a terminal. Pass --value instead.', 0)
  }

  const wasPaused = input.isPaused()
  const wasRaw = input.isRaw
  let value = ''
  let settled = false

  output.write('Secret value: ')
  emitKeypressEvents(input)
  input.setRawMode(true)
  input.resume()

  return new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      input.removeListener('keypress', onKeypress)
      input.setRawMode(wasRaw)
      if (wasPaused) input.pause()
    }

    const finish = (complete: () => void) => {
      if (settled) return
      settled = true
      output.write('\n')
      try {
        cleanup()
        complete()
      } catch (error) {
        reject(error)
      }
    }

    const fail = (message: string) => finish(() => reject(new SimApiError(message, 0)))

    function onKeypress(text: string, key: Key): void {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
        fail('Secret input cancelled.')
        return
      }
      if (key.name === 'return' || key.name === 'enter') {
        if (value.length === 0) fail('Secret value cannot be empty.')
        else finish(() => resolve(value))
        return
      }
      if (key.name === 'backspace') {
        const characters = Array.from(value)
        if (characters.length > 0) {
          characters.pop()
          value = characters.join('')
          output.write('\b \b')
        }
        return
      }
      if (!text || key.ctrl || key.meta || key.name === 'escape') return
      if (value.length + text.length > MAX_SECRET_LENGTH) {
        fail(`Secret value cannot exceed ${MAX_SECRET_LENGTH} characters.`)
        return
      }
      value += text
      output.write('*'.repeat(Array.from(text).length))
    }

    input.on('keypress', onKeypress)
  })
}
