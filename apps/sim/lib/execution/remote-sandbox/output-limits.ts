export const MAX_SANDBOX_OUTPUT_BYTES = 50 * 1024 * 1024

/**
 * How many files one execution may export, whether declared by path or
 * discovered by harvesting the output directory. Exceeding it is an error rather
 * than a truncation: silently returning the first 20 of 100 files reads as
 * success while losing the rest.
 */
export const MAX_SANDBOX_OUTPUT_FILES = 20

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
/**
 * The harvest cannot return what the run produced — too many files, or nested
 * past what the listing reaches. Both are the caller's to fix and neither is
 * retryable, so they share a code and are reported as one 400.
 */
export const SANDBOX_OUTPUT_NOT_EXPORTABLE_CODE = 'sandbox_output_not_exportable' as const

/** More files in the harvest directory than one execution may export. */
export class SandboxOutputFileCountError extends Error {
  readonly code = SANDBOX_OUTPUT_NOT_EXPORTABLE_CODE

  constructor(observedFiles: number, directory: string, limit = MAX_SANDBOX_OUTPUT_FILES) {
    super(
      `Sandbox produced ${observedFiles} files in ${directory}, over the ${limit}-file export limit. Write fewer files, or archive them into a single .zip.`
    )
    this.name = 'SandboxOutputFileCountError'
  }
}

/** Harvest directory nested deeper than the listing can reach. */
export class SandboxOutputDepthError extends Error {
  readonly code = SANDBOX_OUTPUT_NOT_EXPORTABLE_CODE

  constructor(directoryPath: string, maxDepth: number) {
    super(
      `Sandbox output "${directoryPath}" is nested deeper than ${maxDepth} levels, so its contents cannot be returned. Write results closer to the top of the output directory, or archive the tree into a single file.`
    )
    this.name = 'SandboxOutputDepthError'
  }
}

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

/** The harvest directory was removed by the code that was supposed to fill it. */
export class SandboxOutputDirectoryMissingError extends Error {
  readonly code = SANDBOX_OUTPUT_NOT_EXPORTABLE_CODE

  constructor(directoryPath: string) {
    super(
      `The sandbox output directory ${directoryPath} no longer exists — the code deleted it. Write files into it rather than replacing it; no files could be returned from this run.`
    )
    this.name = 'SandboxOutputDirectoryMissingError'
  }
}

export function isSandboxOutputNotExportableError(
  error: unknown
): error is SandboxOutputFileCountError | SandboxOutputDepthError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === SANDBOX_OUTPUT_NOT_EXPORTABLE_CODE
  )
}
