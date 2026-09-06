import { styles } from '#cli/output/presentation'
import { ProfileConfigError } from './config/index'
import {
  formatApiErrorDetails,
  isRequestTimeout,
  RAISE_TIMEOUT_HINT,
  SimApiError,
} from './http/client'
import { sanitize } from './output/render'
import { buildProgram } from './program'

/**
 * Anything the CLI can explain prints as one line and exits 1. An unexpected
 * error keeps its stack trace — that is a bug in the CLI, and hiding it behind a
 * friendly message would make it unreportable.
 */
export async function runTerminalCli(options: { workbench?: boolean } = {}): Promise<void> {
  try {
    await buildProgram(options).parseAsync(process.argv)
  } catch (error) {
    if (error instanceof ProfileConfigError) {
      console.error(styles().red(`Error: ${sanitize(error.message)}`))
      process.exit(1)
    }
    // `AbortSignal.timeout` keeps firing after `fetch` resolves, so a bound that
    // elapses while the body is still being read — a large `files get`, say —
    // surfaces here rather than inside the client. A user's own Ctrl-C raises
    // `AbortError` instead, which is deliberately left alone.
    if (isRequestTimeout(error)) {
      console.error(styles().red(`Error: the request timed out. ${RAISE_TIMEOUT_HINT}`))
      process.exit(1)
    }
    if (error instanceof SimApiError) {
      console.error(styles().red(`Error: ${sanitize(error.message)}`))
      if (error.code) console.error(styles().dim(`  code: ${sanitize(error.code)}`))
      if (error.details !== undefined) {
        for (const line of formatApiErrorDetails(error.details)) {
          console.error(styles().dim(sanitize(line)))
        }
      }
      process.exit(1)
    }
    throw error
  }
}
