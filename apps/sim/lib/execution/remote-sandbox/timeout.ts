import { tailStreamedSandboxOutput } from '@/lib/execution/remote-sandbox/output-limits'
import { SANDBOX_OUTPUT_DIR_SENTINEL } from '@/lib/execution/remote-sandbox/paths'
import type { SandboxDirectoryEntry } from '@/lib/execution/remote-sandbox/types'

/** Output kept from a timed-out workbench run: its end says where the work stopped. */
export const MAX_SANDBOX_TIMEOUT_OUTPUT_TAIL_BYTES = 64 * 1024

/** Output-directory files named in a timeout message; the rest are counted. */
const MAX_NAMED_PERSISTED_FILES = 20

const TIMEOUT_OUTPUT_TRUNCATION_NOTE = '[earlier output omitted]\n'

/** What a workbench run had produced when its own timeout stopped it. */
export interface SandboxTimeoutProgress {
  /** Tail of the combined output streams. */
  output: string
  /** The timeout the code ran under, after which it was stopped. */
  stoppedAfterMs: number
  /** Files already in the call's output directory; they persist with the workbench. */
  outputFiles: string[]
}

/**
 * A workbench process stopped by its own timeout. It is still the `timeout` abort every caller
 * already handles (`isTimeoutAbortReason` accepts it), and additionally carries the run's progress
 * so the caller can return it through its normal output path.
 */
export class SandboxExecutionTimeoutError extends DOMException {
  constructor(readonly progress: SandboxTimeoutProgress) {
    super('timeout', 'AbortError')
  }
}

export function sandboxTimeoutProgress(
  streams: Array<string | undefined>,
  stoppedAfterMs: number,
  listed: SandboxDirectoryEntry[]
): SandboxTimeoutProgress {
  return {
    output: tailStreamedSandboxOutput(
      streams.filter(Boolean).join('\n'),
      MAX_SANDBOX_TIMEOUT_OUTPUT_TAIL_BYTES,
      TIMEOUT_OUTPUT_TRUNCATION_NOTE
    ),
    stoppedAfterMs,
    outputFiles: listed
      .filter(
        (entry) => entry.kind === 'file' && entry.relativePath !== SANDBOX_OUTPUT_DIR_SENTINEL
      )
      .map((entry) => entry.path)
      .sort(),
  }
}

/** Appended to the route's timeout error so the next call resumes the work instead of redoing it. */
export function describeSandboxTimeoutProgress(progress: SandboxTimeoutProgress): string {
  const named = progress.outputFiles.slice(0, MAX_NAMED_PERSISTED_FILES)
  const unnamed = progress.outputFiles.length - named.length
  const files = named.length
    ? ` Already in its output directory: ${named.join(', ')}${unnamed > 0 ? ` and ${unnamed} more` : ''}.`
    : ''
  const output = progress.output ? ' Its output so far is in stdout.' : ''
  return ` The code was stopped after ${Math.round(progress.stoppedAfterMs / 1000)} s.${output} The workbench and the files the code wrote persist.${files} Rerun only the remaining work.`
}
