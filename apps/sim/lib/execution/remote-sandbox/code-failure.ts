import type { SandboxCodeResult, SandboxCommandResult } from '@/lib/execution/remote-sandbox/types'

/**
 * A top-level error headline in a Python traceback or Node crash report: `Name: message`,
 * Node's `Name [CODE]: message` (or `Class [name]: message` for an error class that keeps
 * its parent's name), or the same bracketed with any inline properties after it
 * (`[NameError: message] { … }`) for an error printed without a stack. It starts the line,
 * so the properties Node prints indented beneath an error (`code: 'X'`, `bytesRead: 0`)
 * never match, and a space follows the colon, so source-location headers
 * (`node:internal/x:12`, `file:///x.mjs:3`) don't either. The bracketed form needs an
 * error-type name or that annotation, since Node brackets other thrown values the same
 * way (`[Object: null prototype] {`, `[Function: handler]`).
 */
const ERROR_HEADLINE =
  /^(?:\[(?:[A-Za-z_$][\w.$]*)?(?:Error|Exception)|\[?[A-Za-z_$][\w.$]* \[[\w.$-]+\]|[A-Za-z_$][\w.$]*):(?:\s|$)/

/**
 * Converts a failed code command into a code result, naming the error from the
 * last error headline of the traceback (stderr, else stdout).
 */
export function processCodeFailure(result: SandboxCommandResult): SandboxCodeResult {
  const traceback = result.stderr || result.stdout
  const headline = traceback
    .split('\n')
    .reverse()
    .find((line) => ERROR_HEADLINE.test(line))
  // A bracketed headline closes on this line, or on a later one for a multiline message.
  const errorLine = (
    headline?.startsWith('[') ? headline.slice(1).replace(/\](?: \{.*)?$/, '') : headline
  )?.trim()
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
