/**
 * Execution timeout constants
 *
 * These constants define the timeout values for code execution.
 * - DEFAULT_EXECUTION_TIMEOUT_MS: The default timeout for executing user code (3 minutes)
 * - MAX_EXECUTION_DURATION: The maximum duration for the API route (adds 30s buffer for overhead)
 */

export const DEFAULT_EXECUTION_TIMEOUT_MS = 180000 // 3 minutes (180 seconds)
export const MAX_EXECUTION_DURATION = 210 // 3.5 minutes (210 seconds) - includes buffer for sandbox creation
