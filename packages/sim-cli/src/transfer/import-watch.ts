import { setTimeout as sleep } from 'node:timers/promises'
import { writeStderr } from '#sim-cli/output/io'
import { hasProgressTerminal, styles } from '#sim-cli/output/presentation'

const IMPORT_POLL_MS = 1500
const IMPORT_SETTLED = new Set(['completed', 'failed', 'canceled', 'expired'])

/**
 * Polls an import until it settles, redrawing one progress line on stderr when
 * it is a terminal and clearing it once the import is done.
 */
export async function watchImport<T extends { status: string }>(
  job: T,
  fetchNext: (current: T) => Promise<T>,
  progressLine: (current: T) => string
): Promise<T> {
  let current = job
  let reported: string | null = null
  while (!IMPORT_SETTLED.has(current.status)) {
    await sleep(IMPORT_POLL_MS)
    current = await fetchNext(current)
    const line = progressLine(current)
    if (hasProgressTerminal() && line !== reported) {
      reported = line
      writeStderr(`\r${styles().dim(line)}\u001b[K`)
    }
  }
  if (hasProgressTerminal() && reported !== null) writeStderr('\r\u001b[K')
  return current
}
