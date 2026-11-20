import { createInterface } from 'node:readline/promises'
import { SimApiError } from '#sim-cli/http/client'
import { writeStderr } from '#sim-cli/output/io'

/** The shell's status for a command the user interrupted with Ctrl-C. */
const INTERRUPTED_EXIT_CODE = 130

/**
 * Whether a pending question failed because its input ended: Bun rejects it with an
 * `AbortError` at Ctrl-D, where Node leaves it pending and closes the interface instead.
 */
function isInputEnded(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || ('code' in error && error.code === 'ABORT_ERR'))
  )
}

/**
 * Asks `question` on stderr and resolves the line typed, or `null` when the input ends first
 * (Ctrl-D, or a stdin closed under the prompt), so a caller cancels cleanly instead of hanging
 * or printing a runtime's stack trace. Ctrl-C at a terminal, which readline reads as a key rather
 * than delivering the signal, rejects with a `CANCELLED` error that exits 130, as an interrupt
 * anywhere else does.
 */
export async function askLine(question: string): Promise<string | null> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  const ended = new Promise<null>((resolve) => prompt.once('close', () => resolve(null)))
  const interrupted = new Promise<never>((_resolve, reject) =>
    prompt.once('SIGINT', () =>
      reject(new SimApiError('Interrupted.', 0, 'CANCELLED', undefined, INTERRUPTED_EXIT_CODE))
    )
  )
  try {
    const answer = await Promise.race([prompt.question(question), ended, interrupted])
    if (answer === null) writeStderr('\n')
    return answer
  } catch (error) {
    if (error instanceof SimApiError) writeStderr('\n')
    if (!isInputEnded(error)) throw error
    writeStderr('\n')
    return null
  } finally {
    prompt.close()
  }
}
