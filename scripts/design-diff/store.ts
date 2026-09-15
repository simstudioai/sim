import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { deserialize, serialize } from 'node:v8'
import { LRUCache } from 'lru-cache'
import { counted, measured } from '#design-diff/metrics'
import type { Config } from '#design-diff/types'
import type { Database } from 'bun:sqlite'

export const INDEX_VERSION = '1.0.0'
const ROW_LIMIT = 4 * 1024 * 1024
const DEFAULT_LIMIT = 1024 * 1024 * 1024
export const contentHash = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')

/** Cache identities describe trusted tooling, not the proposed application's executable configuration. */
export function indexIdentity(config: Config): string {
  const root = new URL('./', import.meta.url)
  const files = [
    ...readdirSync(root).filter((name) => name.endsWith('.ts')),
    ...readdirSync(new URL('extract/', root))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => `extract/${name}`),
  ]
    .filter((name) => !['benchmark.ts', 'index-cli.ts', 'cli.ts'].includes(name))
    .sort()
  return contentHash(
    serialize({
      version: INDEX_VERSION,
      implementation: files.map((file) => [file, contentHash(readFileSync(new URL(file, root)))]),
      lock: contentHash(readFileSync(new URL('../../bun.lock', root))),
      config,
      runtime:
        (globalThis as typeof globalThis & { Bun?: { version: string } }).Bun?.version ??
        process.version,
      platform: process.platform,
      architecture: process.arch,
    })
  )
}

interface Row {
  payload: Uint8Array
  checksum: string
}

/** Optional, disposable storage. A storage failure never becomes a clean analysis result. */
export class IndexStore {
  private readonly memory = new LRUCache<string, Buffer>({
    maxSize: 64 * 1024 * 1024,
    sizeCalculation: (value) => value.byteLength,
  })
  private readonly pending = new Map<string, Buffer>()
  private pendingBytes = 0
  private constructor(
    private db: Database | undefined,
    readonly identity: string,
    private readonly limit: number,
    private readonly snapshots: number
  ) {}

  /** Uncached analysis uses the same queries with process-local, bounded storage. */
  static transient(config: Config): IndexStore {
    return new IndexStore(undefined, indexIdentity(config), DEFAULT_LIMIT, 10)
  }

  static async open(
    directory: string,
    config: Config,
    limit = DEFAULT_LIMIT,
    snapshots = 10
  ): Promise<IndexStore> {
    const store = new IndexStore(undefined, indexIdentity(config), limit, snapshots)
    const file = path.join(directory, 'index.sqlite')
    try {
      mkdirSync(directory, { recursive: true })
      const { Database } = await import('bun:sqlite')
      const open = () => {
        const db = new Database(file, { create: true, strict: true })
        try {
          db.exec('PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=5000;')
          const version = db.query('PRAGMA user_version').get() as { user_version: number }
          if (![0, 1].includes(version.user_version)) throw new Error('Incompatible index')
          const check = db.query('PRAGMA quick_check').get() as { quick_check: string }
          if (check.quick_check !== 'ok') throw new Error('Corrupt index')
          db.exec(`PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS entries (namespace TEXT NOT NULL, key TEXT NOT NULL, payload BLOB NOT NULL, checksum TEXT NOT NULL, bytes INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(namespace,key));
            CREATE TABLE IF NOT EXISTS snapshots (namespace TEXT NOT NULL, commit_id TEXT NOT NULL, payload BLOB NOT NULL, checksum TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(namespace,commit_id));
            PRAGMA user_version=1; PRAGMA journal_size_limit=16777216;`)
          return db
        } catch (error) {
          db.close()
          throw error
        }
      }
      try {
        store.db = open()
      } catch (error) {
        if (!/corrupt|malformed|not a database|incompatible index/i.test(String(error))) throw error
        counted('cache.recovered')
        for (const suffix of ['', '-wal', '-shm']) {
          try {
            renameSync(file + suffix, `${file}.discarded-${process.pid}${suffix}`)
          } catch {
            /** Missing sidecars need no recovery. */
          }
        }
        store.db = open()
        for (const suffix of ['', '-wal', '-shm'])
          rmSync(`${file}.discarded-${process.pid}${suffix}`, { force: true })
      }
    } catch {
      counted('cache.unavailable')
    }
    return store
  }

  get persistent(): boolean {
    return this.db !== undefined
  }

  get<T>(key: string): T | undefined {
    return measured('cacheRead', () => {
      let bytes = this.pending.get(key) ?? this.memory.get(key)
      if (!bytes && this.db) {
        try {
          const row = this.db
            .query('SELECT payload,checksum FROM entries WHERE namespace=? AND key=? AND bytes<=?')
            .get(this.identity, key, ROW_LIMIT) as Row | null
          if (
            row &&
            row.payload.byteLength <= ROW_LIMIT &&
            contentHash(row.payload) === row.checksum
          ) {
            bytes = Buffer.from(row.payload)
            this.memory.set(key, bytes)
          } else if (row) counted('cache.corruptRows')
        } catch {
          this.disable()
        }
      }
      if (!bytes) {
        counted('cache.misses')
        return undefined
      }
      try {
        const value = deserialize(bytes) as T
        counted('cache.hits')
        return value
      } catch {
        counted('cache.corruptRows')
        return undefined
      }
    })
  }

  put(key: string, value: unknown): void {
    if (value === undefined) return
    try {
      const payload = serialize(value)
      if (payload.byteLength > ROW_LIMIT) {
        counted('cache.oversizedRows')
        return
      }
      this.memory.set(key, payload)
      if (!this.db) return
      this.pendingBytes -= this.pending.get(key)?.byteLength ?? 0
      this.pending.set(key, payload)
      this.pendingBytes += payload.byteLength
      if (this.pendingBytes >= 4 * 1024 * 1024 || this.pending.size >= 256) this.flush()
    } catch {
      counted('cache.unserializable')
    }
  }

  private disable() {
    counted('cache.unavailable')
    try {
      this.db?.close()
    } catch {
      /** The cache is disposable. */
    }
    this.db = undefined
    this.pending.clear()
    this.pendingBytes = 0
  }

  flush(): void {
    if (!this.db || !this.pending.size) return
    try {
      const insert = this.db.query('INSERT OR REPLACE INTO entries VALUES (?,?,?,?,?,?)')
      this.db.transaction(() => {
        for (const [key, payload] of this.pending)
          insert.run(
            this.identity,
            key,
            payload,
            contentHash(payload),
            payload.byteLength,
            Date.now()
          )
      })()
      const size = this.db.query('SELECT COALESCE(SUM(bytes),0) AS bytes FROM entries').get() as {
        bytes: number
      }
      if (size.bytes > this.limit * 0.75) {
        this.db.exec(
          'DELETE FROM entries WHERE rowid IN (SELECT rowid FROM entries ORDER BY used,namespace,key LIMIT (SELECT count(*)/2+1 FROM entries))'
        )
        counted('cache.evictions')
      }
      counted('cache.writtenRows', this.pending.size)
      this.pending.clear()
      this.pendingBytes = 0
    } catch {
      this.disable()
    }
  }

  complete(commit: string, inventory: unknown): void {
    this.flush()
    if (!this.db) return
    try {
      const payload = serialize(inventory)
      if (payload.byteLength > this.limit) return
      this.db
        .query('INSERT OR IGNORE INTO snapshots VALUES (?,?,?,?,?)')
        .run(this.identity, commit, payload, contentHash(payload), Date.now())
      this.db
        .query(
          'DELETE FROM snapshots WHERE rowid NOT IN (SELECT rowid FROM snapshots ORDER BY used DESC, namespace, commit_id LIMIT ?)'
        )
        .run(this.snapshots)
      const size = this.db.query('SELECT COALESCE(SUM(bytes),0) AS bytes FROM entries').get() as {
        bytes: number
      }
      if (size.bytes > this.limit * 0.8) {
        this.db.exec(
          'DELETE FROM entries WHERE rowid IN (SELECT rowid FROM entries ORDER BY used, namespace, key LIMIT (SELECT count(*)/2+1 FROM entries))'
        )
        counted('cache.evictions')
      }
    } catch {
      this.disable()
    }
  }

  close(): void {
    this.flush()
    try {
      if (this.db) {
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
        const pages = this.db.query('PRAGMA page_count').get() as { page_count: number }
        const size = this.db.query('PRAGMA page_size').get() as { page_size: number }
        if (pages.page_count * size.page_size > this.limit) {
          this.db.exec(
            'DELETE FROM entries; DELETE FROM snapshots; VACUUM; PRAGMA wal_checkpoint(TRUNCATE);'
          )
          counted('cache.evictions')
        }
        this.db.close()
      }
    } catch {
      this.disable()
    }
    this.db = undefined
  }
}
