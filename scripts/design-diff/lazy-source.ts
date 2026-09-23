import { LRUCache } from 'lru-cache'
import type { Entry, GitReader } from '#design-diff/git'
import { counted } from '#design-diff/metrics'

/** Path enumeration is cheap; blob contents are fetched only by consumers that need them. */
export class LazySources implements Iterable<[string, string]> {
  private readonly cached = new LRUCache<string, string>({
    maxSize: 96 * 1024 * 1024,
    sizeCalculation: (value) => Math.max(1, Buffer.byteLength(value)),
  })
  private readonly entries: Map<string, Entry>
  private readonly order: string[]
  private readonly positions: Map<string, number>
  constructor(
    private readonly reader: GitReader,
    entries: Entry[],
    private readonly observe: (file: string) => void
  ) {
    this.entries = new Map(entries.map((entry) => [entry.path, entry]))
    this.order = [...this.entries.keys()]
    this.positions = new Map(this.order.map((file, index) => [file, index]))
  }
  has(file: string): boolean {
    this.observe(file)
    return this.entries.has(file)
  }
  keys(): MapIterator<string> {
    return this.entries.keys()
  }
  get(file: string): string | undefined {
    this.observe(file)
    const entry = this.entries.get(file)
    if (!entry) return undefined
    const cached = this.cached.get(file)
    if (cached !== undefined) return cached
    const start = this.positions.get(file)!
    const batch: string[] = []
    let bytes = 0
    for (const candidate of this.order.slice(start, start + 128)) {
      bytes += this.entries.get(candidate)!.size
      if (bytes > 8 * 1024 * 1024 && batch.length) break
      batch.push(candidate)
    }
    this.prefetch(batch)
    return this.cached.get(file)
  }
  prefetch(files: string[]): void {
    const entries = files
      .filter((file) => !this.cached.has(file))
      .flatMap((file) => this.entries.get(file) ?? [])
    for (const [file, value] of this.reader.blobs(entries)) {
      counted('source.loadedBytes', Buffer.byteLength(value))
      this.cached.set(file, value)
    }
  }
  *[Symbol.iterator](): IterableIterator<[string, string]> {
    for (const file of this.entries.keys()) yield [file, this.get(file)!]
  }
}
