import { OrchestrationError } from '@/lib/core/orchestration/types'

export const MAX_RICH_MEMORY_PAGE_BYTES = 4 * 1024 * 1024
export const MAX_PLAIN_MEMORY_READ_ROWS = 10_000
export const MAX_PLAIN_MEMORY_READ_BYTES = 16 * 1024 * 1024

/** One compatibility response shares this budget across every appended-message tail it reads. */
export class PlainMemoryReadBudget {
  private rows = 0
  private bytes = 0

  constructor(
    private readonly limits = {
      rows: MAX_PLAIN_MEMORY_READ_ROWS,
      bytes: MAX_PLAIN_MEMORY_READ_BYTES,
    }
  ) {}

  reserve(rows: number, bytes: number): void {
    if (
      !Number.isSafeInteger(rows) ||
      !Number.isSafeInteger(bytes) ||
      rows < 0 ||
      bytes < 0 ||
      this.rows + rows > this.limits.rows ||
      this.bytes + bytes > this.limits.bytes
    ) {
      throw new OrchestrationError(
        'payload_too_large',
        `Memory response exceeds the appended-history limit (${this.limits.rows} messages or ${this.limits.bytes} bytes). Read fewer conversations or start a new conversation.`
      )
    }
    this.rows += rows
    this.bytes += bytes
  }
}
