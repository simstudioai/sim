/** Matches the host's 16 MiB inline materialization ceiling, before worker window shaping. */
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024
const BLOCK_BYTES = 64 * 1024

export class EmbeddedOutputLimitError extends Error {
  constructor() {
    super(
      'Embedded CLI output limit exceeded (16 MiB per stream); captured output is incomplete. ' +
        'The command may already have completed. Do not repeat a mutation to recover output; ' +
        'inspect its current state. Narrow reads, or use files get --output-file <path> for file bytes.'
    )
  }
}

/** Byte capture preserves write boundaries and bounds both bytes and allocation count. */
export class EmbeddedOutput {
  private readonly blocks: Buffer[] = []
  private pending: Buffer | undefined
  private used = 0
  private total = 0
  limitError: EmbeddedOutputLimitError | undefined

  write(chunk: string | Uint8Array, encoding: BufferEncoding = 'utf8'): void {
    if (this.limitError) throw this.limitError
    const length = typeof chunk === 'string' ? Buffer.byteLength(chunk, encoding) : chunk.byteLength
    if (length > MAX_CAPTURE_BYTES - this.total) {
      this.limitError = new EmbeddedOutputLimitError()
      throw this.limitError
    }
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : chunk
    let offset = 0
    while (offset < bytes.byteLength) {
      this.pending ??= Buffer.allocUnsafe(BLOCK_BYTES)
      const count = Math.min(BLOCK_BYTES - this.used, bytes.byteLength - offset)
      this.pending.set(bytes.subarray(offset, offset + count), this.used)
      offset += count
      this.used += count
      if (this.used === BLOCK_BYTES) {
        this.blocks.push(this.pending)
        this.pending = undefined
        this.used = 0
      }
    }
    this.total += length
  }

  /** Error rendering and cleanup must still finish when diagnostic capture fills up. */
  diagnostic(message: string): void {
    try {
      this.write(`${message}\n`)
    } catch (error) {
      if (!(error instanceof EmbeddedOutputLimitError)) throw error
    }
  }

  text(): string {
    const chunks = this.pending
      ? [...this.blocks, this.pending.subarray(0, this.used)]
      : this.blocks
    return Buffer.concat(chunks, this.total).toString('utf8')
  }
}
