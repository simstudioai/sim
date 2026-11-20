import { createInterface } from 'node:readline/promises'
import { writeStderr } from '#sim-cli/output/io'

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
 * or printing a runtime's stack trace.
 */
export async function askLine(question: string): Promise<string | null> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  const ended = new Promise<null>((resolve) => prompt.once('close', () => resolve(null)))
  try {
    const answer = await Promise.race([prompt.question(question), ended])
    if (answer === null) writeStderr('\n')
    return answer
  } catch (error) {
    if (!isInputEnded(error)) throw error
    writeStderr('\n')
    return null
  } finally {
    prompt.close()
  }
}
