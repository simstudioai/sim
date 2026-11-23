import type { Command } from 'commander'
import { dump } from 'js-yaml'
import { styles } from '#sim-cli/output/presentation'
import { CliUpdateError } from '#sim-cli/update/install'
import { ProfileConfigError } from './config/index'
import { profileFrom } from './context'
import { CliExit } from './embed-context'
import {
  formatApiErrorDetails,
  isRequestTimeout,
  RAISE_TIMEOUT_HINT,
  SimApiError,
} from './http/client'
import { flushOutput, printError, writeStderr } from './output/io'
import { sanitize } from './output/render'
import { buildProgram } from './program'
import { createCommandTelemetry } from './telemetry/index'

/**
 * Prints the one-line explanation for an error the CLI understands and returns
 * the exit code it deserves, or `null` for an error it does not: that is a bug
 * in the CLI, and hiding it behind a friendly message would make it
 * unreportable, so the caller prints it with its stack trace.
 */
function explainFailure(error: unknown, program: Command): number | null {
  if (error instanceof CliExit) return error.code
  if (error instanceof ProfileConfigError || error instanceof CliUpdateError) {
    printError(styles().red(`Error: ${sanitize(error.message)}`))
    return 1
  }
  // `AbortSignal.timeout` keeps firing after `fetch` resolves, so a bound that
  // elapses while the body is still being read — a large `files get`, say —
  // surfaces here rather than inside the client. A user's own Ctrl-C raises
  // `AbortError` instead, which is deliberately left alone.
  if (isRequestTimeout(error)) {
    printError(styles().red(`Error: the request timed out. ${RAISE_TIMEOUT_HINT}`))
    return 1
  }
  if (error instanceof SimApiError) {
    let output = program.opts().output
    try {
      output = profileFrom(program).output
    } catch {
      /** Preserve the original error when configuration is invalid. */
    }
    if (output === 'json' || output === 'yaml') {
      const payload = {
        error: {
          code: error.code ?? 'CLI_ERROR',
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          ...(error.requestId ? { requestId: error.requestId } : {}),
        },
      }
      writeStderr(output === 'json' ? `${JSON.stringify(payload)}\n` : dump(payload))
      return error.exitCode
    }
    printError(styles().red(`Error: ${sanitize(error.message)}`))
    if (error.code) printError(styles().dim(`  code: ${sanitize(error.code)}`))
    if (error.details !== undefined) {
      for (const line of formatApiErrorDetails(error.details)) {
        printError(styles().dim(sanitize(line)))
      }
    }
    if (error.requestId) printError(styles().dim(`  request id: ${sanitize(error.requestId)}`))
    return error.exitCode
  }
  return null
}

/**
 * Anything the CLI can explain prints as one line and exits with its code. A
 * failure is reported here, where its class and code are known; every other
 * way the process ends is reported from the exit listener telemetry installs.
 * Every exit waits for stdout and stderr to drain first (see {@link flushOutput}).
 */
export async function runTerminalCli(suppliedProgram?: Command): Promise<void> {
  const telemetry = suppliedProgram ? undefined : createCommandTelemetry()
  const program = suppliedProgram ?? buildProgram()
  telemetry?.observe(program)
  try {
    await program.parseAsync(process.argv)
  } catch (error) {
    const exitCode = explainFailure(error, program)
    telemetry?.complete(
      error instanceof CliExit ? { exitCode: error.code } : { exitCode: exitCode ?? 1, error }
    )
    if (exitCode === null) printError(error)
    await flushOutput()
    process.exit(exitCode ?? 1)
  }
}
