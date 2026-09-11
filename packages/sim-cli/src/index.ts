#!/usr/bin/env node

import chalk from 'chalk'
import type { Command } from 'commander'
import { dump } from 'js-yaml'
import { CliUpdateError } from '#sim-cli/update/install'
import { ProfileConfigError } from './config/index'
import { clientFrom } from './context'
import {
  formatApiErrorDetails,
  isRequestTimeout,
  RAISE_TIMEOUT_HINT,
  SimApiError,
} from './http/client'
import { sanitize } from './output/render'
import { buildProgram } from './program'
import { createCommandTelemetry } from './telemetry/index'

/**
 * Prints the one-line explanation for an error the CLI understands and returns
 * the exit code it deserves, or `null` for an error it does not: that is a bug
 * in the CLI, and hiding it behind a friendly message would make it
 * unreportable, so the caller lets it keep its stack trace.
 */
function explainFailure(error: unknown, program: Command): number | null {
  if (error instanceof ProfileConfigError || error instanceof CliUpdateError) {
    console.error(chalk.red(`Error: ${sanitize(error.message)}`))
    return 1
  }
  // `AbortSignal.timeout` keeps firing after `fetch` resolves, so a bound that
  // elapses while the body is still being read — a large `files get`, say —
  // surfaces here rather than inside the client. A user's own Ctrl-C raises
  // `AbortError` instead, which is deliberately left alone.
  if (isRequestTimeout(error)) {
    console.error(chalk.red(`Error: the request timed out. ${RAISE_TIMEOUT_HINT}`))
    return 1
  }
  if (error instanceof SimApiError) {
    let output = program.opts().output
    try {
      output = clientFrom(program).profile.output
    } catch {
      /** Preserve the original error when configuration is invalid. */
    }
    if (output === 'json' || output === 'yaml') {
      const payload = {
        error: {
          code: error.code ?? 'CLI_ERROR',
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      }
      process.stderr.write(output === 'json' ? `${JSON.stringify(payload)}\n` : dump(payload))
      return error.exitCode
    }
    console.error(chalk.red(`Error: ${sanitize(error.message)}`))
    if (error.code) console.error(chalk.dim(`  code: ${sanitize(error.code)}`))
    if (error.details !== undefined) {
      for (const line of formatApiErrorDetails(error.details)) {
        console.error(chalk.dim(sanitize(line)))
      }
    }
    return error.exitCode
  }
  return null
}

/**
 * Anything the CLI can explain prints as one line and exits with its code. A
 * failure is reported here, where its class and code are known; every other
 * way the process ends is reported from the exit listener telemetry installs.
 */
async function main() {
  const telemetry = createCommandTelemetry()
  const program = buildProgram()
  telemetry.observe(program)
  try {
    await program.parseAsync(process.argv)
  } catch (error) {
    const exitCode = explainFailure(error, program)
    telemetry.complete({ exitCode: exitCode ?? 1, error })
    if (exitCode === null) throw error
    process.exit(exitCode)
  }
}

main()
