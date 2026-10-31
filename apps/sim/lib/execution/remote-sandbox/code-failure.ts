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

const SIGNAL_NAMES: Readonly<Record<number, string>> = {
  6: 'SIGABRT',
  9: 'SIGKILL',
  11: 'SIGSEGV',
  15: 'SIGTERM',
}

/**
 * `Process exited with code N`, naming the signal behind a code above 128. A killed process often
 * printed only a warning first, and that warning must not read as the reason it failed; SIGKILL
 * (137) is usually the out-of-memory killer.
 */
export function describeProcessExit(exitCode: number): string {
  const described = `Process exited with code ${exitCode}`
  const signal = killingSignal(exitCode)
  if (signal === undefined) return described
  const name = SIGNAL_NAMES[signal] ?? `signal ${signal}`
  return `${described} (killed by ${name}${signal === 9 ? ', usually out of memory' : ''})`
}

/** The signal a shell's `128 + n` exit code reports, if the code is one. */
function killingSignal(exitCode: number): number | undefined {
  return exitCode > 128 && exitCode <= 128 + 64 ? exitCode - 128 : undefined
}

/**
 * Converts a failed code command into a code result, naming the error from the
 * last error headline of the traceback (stderr, else stdout). A process a signal
 * killed raised nothing: anything it printed (a warning) is not the cause, so the
 * signal names the error and the output stays as the traceback.
 */
export function processCodeFailure(result: SandboxCommandResult): SandboxCodeResult {
  const traceback = result.stderr || result.stdout
  if (killingSignal(result.exitCode) !== undefined) {
    return {
      text: '',
      stdout: result.stdout,
      stderr: result.stderr,
      error: { name: 'Error', value: describeProcessExit(result.exitCode), traceback },
    }
  }
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
