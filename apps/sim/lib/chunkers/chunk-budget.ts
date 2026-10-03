/** Raised before a chunker would produce more than its configured output ceiling. */
export class ChunkLimitExceededError extends Error {
  readonly maxChunks: number

  constructor(maxChunks: number) {
    super(`Chunk production exceeded the configured limit of ${maxChunks.toLocaleString()}`)
    this.name = 'ChunkLimitExceededError'
    this.maxChunks = maxChunks
  }
}

/** Shared output budget that lets recursive chunkers enforce one aggregate ceiling. */
export class ChunkBudget {
  private produced = 0
  private readonly maxChunks?: number

  constructor(maxChunks?: number) {
    if (maxChunks !== undefined && (!Number.isSafeInteger(maxChunks) || maxChunks < 0)) {
      throw new RangeError('maxChunks must be a non-negative safe integer')
    }
    this.maxChunks = maxChunks
  }

  add<T>(target: T[], value: T): void {
    if (this.maxChunks !== undefined && this.produced >= this.maxChunks) {
      throw new ChunkLimitExceededError(this.maxChunks)
    }
    target.push(value)
    this.produced++
  }
}
