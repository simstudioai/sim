import type { SandboxCodeResult, SandboxCommandResult } from '@/lib/execution/remote-sandbox/types'

/**
 * Converts a failed code command into a code result, naming the error from the
 * last `Name: message` line of the traceback (stderr, else stdout).
 */
export function processCodeFailure(result: SandboxCommandResult): SandboxCodeResult {
  const traceback = result.stderr || result.stdout
  const errorLine = traceback
    .split('\n')
    .reverse()
    .find((line) => /^[A-Za-z_$][\w.$]*(?:Error|Exception|Interrupt|Exit)?:\s*/.test(line.trim()))
    ?.trim()
  const separator = errorLine?.indexOf(':') ?? -1
  const parsedErrorLine = errorLine ?? ''
  const name = separator > 0 ? parsedErrorLine.slice(0, separator) : 'Error'
  const value =
    separator > 0
      ? parsedErrorLine.slice(separator + 1).trim()
      : parsedErrorLine || 'Execution failed'
  return {
    text: '',
    stdout: result.stdout,
    stderr: result.stderr,
    error: { name, value, traceback },
  }
}
