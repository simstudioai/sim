import { emitKeypressEvents, type Key } from 'node:readline'
import type { ReadStream } from 'node:tty'
import { SimApiError } from '../http/client'

const MAX_SECRET_LENGTH = 65_536

/**
 * Raised when the user abandons the prompt with Ctrl-C or Ctrl-D, so the caller
 * can exit 130 rather than folding an abort into the generic failure code.
 */
export class SecretInputCancelledError extends SimApiError {
  constructor() {
    super('Secret input cancelled.', 0)
    this.name = 'SecretInputCancelledError'
  }
}

interface SecretOutput {
  write(value: string): unknown
}

/**
 * The character a meta keypress carries, if it carries one at all.
 *
 * Node's keypress parser folds an ESC byte and the character after it into a
 * single meta keypress with no text, so dropping every meta key silently ate
 * the character following an ESC pasted into a secret — a shortened secret with
 * no warning. Recovering it from the sequence keeps the paste whole. A
 * navigation key (`ESC[A`, `ESC[1;3A`) leaves more than one character behind
 * once the escapes are stripped, so it stays ignored, as does a lone ESC.
 */
function metaCharacter(key: Key): string {
  if (!key.meta || !key.sequence) return ''
  const character = key.sequence.replace(/^\u001b+/, '')
  if (character.length !== 1 || character < ' ' || character === '\u007f') return ''
  return character
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
    const cancel = () => finish(() => reject(new SecretInputCancelledError()))

    function onKeypress(text: string, key: Key): void {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
        cancel()
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
      const entered = text || metaCharacter(key)
      if (!entered || key.ctrl || key.name === 'escape') return
      if (value.length + entered.length > MAX_SECRET_LENGTH) {
        fail(`Secret value cannot exceed ${MAX_SECRET_LENGTH} characters.`)
        return
      }
      value += entered
      output.write('*'.repeat(Array.from(entered).length))
    }

    input.on('keypress', onKeypress)
  })
}
