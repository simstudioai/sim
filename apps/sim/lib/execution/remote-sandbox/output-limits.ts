export const MAX_SANDBOX_OUTPUT_BYTES = 50 * 1024 * 1024

/**
 * Maximum combined stdout, stderr, result text, and structured error text kept
 * for one sandbox operation. Function results larger than this should be
 * exported as files, where the separate file budget applies.
 */
export const MAX_SANDBOX_PROCESS_OUTPUT_BYTES = 10 * 1024 * 1024

/**
 * Diagnostic tail kept from a stream the caller consumed itself.
 *
 * Providers that can discard callback-delivered output use this tail as their only retained copy.
 * E2B's SDK always accumulates the full streams internally, so its adapter must still enforce the
 * process-output budget before applying this diagnostic tail to the returned result.
 */
export const MAX_SANDBOX_STREAMED_OUTPUT_TAIL_BYTES = 64 * 1024

const STREAMED_OUTPUT_TRUNCATION_NOTE =
  '[earlier output truncated — it was streamed to the caller]\n'

/**
 * Keeps the last {@link MAX_SANDBOX_STREAMED_OUTPUT_TAIL_BYTES} of a streamed output. The cut is
 * advanced past any UTF-8 continuation bytes so the tail starts on a code-point boundary rather
 * than decoding to replacement characters.
 */
export function tailStreamedSandboxOutput(
  value: string | undefined,
  limitBytes = MAX_SANDBOX_STREAMED_OUTPUT_TAIL_BYTES
): string {
  if (!value) return ''
  const buffer = Buffer.from(value, 'utf8')
  if (buffer.length <= limitBytes) return value

  let start = buffer.length - limitBytes
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start += 1
  return `${STREAMED_OUTPUT_TRUNCATION_NOTE}${buffer.subarray(start).toString('utf8')}`
}

/**
 * Appends to a streamed-output accumulator, collapsing it back to the diagnostic tail once it grows
 * past twice that tail. Truncating on every chunk would be quadratic over a long stream. The
 * threshold compares UTF-16 length rather than bytes because it only decides *when* to collapse —
 * {@link tailStreamedSandboxOutput} does the byte-exact cut.
 */
export function appendStreamedSandboxOutput(current: string, chunk: string): string {
  const next = current + chunk
  return next.length > MAX_SANDBOX_STREAMED_OUTPUT_TAIL_BYTES * 2
    ? tailStreamedSandboxOutput(next)
    : next
}

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
