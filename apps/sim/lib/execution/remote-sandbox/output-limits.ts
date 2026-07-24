import type { RunCommandOptions } from '@/lib/execution/remote-sandbox/types'

export class SandboxOutputLimitError extends Error {
  constructor() {
    super('Sandbox command output limit exceeded')
    this.name = 'SandboxOutputLimitError'
  }
}

export function createSandboxOutputLimiter(options: RunCommandOptions) {
  let stdoutBytes = 0
  let stderrBytes = 0
  let limitExceeded = false

  const accept = (stream: 'stdout' | 'stderr', chunk: string): void => {
    const bytes = Buffer.byteLength(chunk)
    if (stream === 'stdout') stdoutBytes += bytes
    else stderrBytes += bytes
    if (
      (options.maxStdoutBytes !== undefined && stdoutBytes > options.maxStdoutBytes) ||
      (options.maxStderrBytes !== undefined && stderrBytes > options.maxStderrBytes) ||
      (options.maxCombinedBytes !== undefined &&
        stdoutBytes + stderrBytes > options.maxCombinedBytes)
    ) {
      limitExceeded = true
      throw new SandboxOutputLimitError()
    }
  }

  return {
    stdout(chunk: string) {
      accept('stdout', chunk)
      options.onStdout?.(chunk)
    },
    stderr(chunk: string) {
      accept('stderr', chunk)
      options.onStderr?.(chunk)
    },
    exceeded() {
      return limitExceeded
    },
  }
}
