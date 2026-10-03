import { Buffer } from 'node:buffer'
import { FileParserError } from '@/lib/file-parsers/errors'

/** Bounds both text bytes and retained string fragments while extracting complete documents. */
export class CompleteTextBuilder {
  private readonly parts: string[] = []
  private pending = ''
  private pendingBytes = 0
  private bytes = 0

  constructor(private readonly maxBytes = 25 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
      throw new Error('Invalid extraction byte budget')
  }

  append(text: string): void {
    const bytes = Buffer.byteLength(text, 'utf8')
    if (this.bytes + bytes > this.maxBytes) {
      throw new FileParserError(
        'complexity_limit',
        'Complete text extraction exceeds its byte budget'
      )
    }
    this.bytes += bytes
    this.pending += text
    this.pendingBytes += bytes
    if (this.pendingBytes >= 64 * 1024) {
      this.parts.push(this.pending)
      this.pending = ''
      this.pendingBytes = 0
    }
  }

  finish(): string {
    return this.parts.join('') + this.pending
  }
}
