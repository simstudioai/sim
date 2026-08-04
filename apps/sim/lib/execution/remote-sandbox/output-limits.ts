export const MAX_SANDBOX_OUTPUT_BYTES = 50 * 1024 * 1024

/**
 * Maximum combined stdout, stderr, result text, and structured error text kept
 * for one sandbox operation. Function results larger than this should be
 * exported as files, where the separate file budget applies.
 */
export const MAX_SANDBOX_PROCESS_OUTPUT_BYTES = 10 * 1024 * 1024

export const SANDBOX_OUTPUT_LIMIT_CODE = 'sandbox_output_limit_exceeded' as const
export const SANDBOX_OUTPUT_FILE_INVALID_CODE = 'sandbox_output_file_invalid' as const

export class SandboxOutputFileError extends Error {
  readonly code = SANDBOX_OUTPUT_FILE_INVALID_CODE

  constructor(path: string) {
    super(`Sandbox output path must reference a regular file: ${path}`)
    this.name = 'SandboxOutputFileError'
  }
}

/** Raised before provider output bytes enter the web process. */
export class SandboxOutputLimitError extends Error {
  readonly code = SANDBOX_OUTPUT_LIMIT_CODE
  readonly attemptedBytes: number
  readonly limitBytes: number
  readonly outputKind: 'files' | 'process'

  constructor(
    attemptedBytes: number,
    limitBytes = MAX_SANDBOX_OUTPUT_BYTES,
    outputKind: 'files' | 'process' = 'files'
  ) {
    super(
      outputKind === 'files'
        ? `Sandbox output files exceed ${limitBytes} bytes total`
        : `Sandbox process output exceeds ${limitBytes} bytes total. Write large results to a sandbox file and export it instead.`
    )
    this.name = 'SandboxOutputLimitError'
    this.attemptedBytes = attemptedBytes
    this.limitBytes = limitBytes
    this.outputKind = outputKind
  }
}

/** Counts UTF-8 bytes before provider output is retained by Sim. */
export class SandboxProcessOutputBudget {
  private observedBytes = 0
  private overflowError: SandboxOutputLimitError | undefined

  constructor(private readonly limitBytes = MAX_SANDBOX_PROCESS_OUTPUT_BYTES) {}

  add(value: string | Uint8Array | undefined): void {
    if (!value) return
    if (this.overflowError) throw this.overflowError

    const bytes = typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength
    const attemptedBytes = this.observedBytes + bytes
    if (attemptedBytes > this.limitBytes) {
      this.overflowError = new SandboxOutputLimitError(attemptedBytes, this.limitBytes, 'process')
      throw this.overflowError
    }
    this.observedBytes = attemptedBytes
  }

  get error(): SandboxOutputLimitError | undefined {
    return this.overflowError
  }
}

export function assertSandboxProcessOutputWithinLimit(
  values: Array<string | Uint8Array | undefined>,
  limitBytes = MAX_SANDBOX_PROCESS_OUTPUT_BYTES
): void {
  const budget = new SandboxProcessOutputBudget(limitBytes)
  for (const value of values) budget.add(value)
}

export function isSandboxOutputLimitError(error: unknown): error is SandboxOutputLimitError {
  return (
    error instanceof SandboxOutputLimitError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === SANDBOX_OUTPUT_LIMIT_CODE)
  )
}

export function isSandboxOutputFileError(error: unknown): error is SandboxOutputFileError {
  return (
    error instanceof SandboxOutputFileError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === SANDBOX_OUTPUT_FILE_INVALID_CODE)
  )
}
