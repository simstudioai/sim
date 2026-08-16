#!/usr/bin/env node

import chalk from 'chalk'
import { ProfileConfigError } from './config/index'
import { formatApiErrorDetails, SimApiError } from './http/client'
import { sanitize } from './output/render'
import { buildProgram } from './program'

/**
 * Anything the CLI can explain prints as one line and exits 1. An unexpected
 * error keeps its stack trace — that is a bug in the CLI, and hiding it behind a
 * friendly message would make it unreportable.
 */
async function main() {
  try {
    await buildProgram().parseAsync(process.argv)
  } catch (error) {
    if (error instanceof ProfileConfigError) {
      console.error(chalk.red(`Error: ${sanitize(error.message)}`))
      process.exit(1)
    }
    if (error instanceof SimApiError) {
      console.error(chalk.red(`Error: ${sanitize(error.message)}`))
      if (error.code) console.error(chalk.dim(`  code: ${sanitize(error.code)}`))
      if (error.details !== undefined) {
        for (const line of formatApiErrorDetails(error.details)) {
          console.error(chalk.dim(sanitize(line)))
        }
      }
      process.exit(1)
    }
    throw error
  }
}

main()
