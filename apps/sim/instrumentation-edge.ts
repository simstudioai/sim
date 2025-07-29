/**
 * Sim Telemetry - Edge Runtime Instrumentation
 *
 * This file contains Edge Runtime-compatible instrumentation logic.
 * No Node.js APIs (like process.on, crypto, fs, etc.) are allowed here.
 */

import { createLogger } from './lib/logs/console/logger'

const logger = createLogger('EdgeInstrumentation')

export async function register() {
  try {
    // Only Web API compatible code here
    // No Node.js APIs like process.on, crypto, fs, etc.

    // Future: Add Edge Runtime compatible telemetry here
    logger.info('Edge Runtime instrumentation initialized')
  } catch (error) {
    logger.error('Failed to initialize Edge Runtime instrumentation', error)
  }
}
