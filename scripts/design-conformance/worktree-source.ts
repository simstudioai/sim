import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { productScope } from '#control-analysis/scope'
import { typographySource } from '#control-analysis/typography'
import { centralInventory, registry } from '#design-conformance/contracts'
import { verifiedText } from '#design-conformance/io'
import type { Entry } from '#design-conformance/model'
import { TOKEN_FILE } from '#design-conformance/model'
import { type SystemInput, snapshotHash } from '#design-conformance/system-snapshot'

export interface SourceEntry extends Entry {
  bytes: number
  kind: string
}

/** Git tree/blob reads only: no checkout, textconv, filters, hooks or application imports. */
export class GitSource {
  readonly mode: 'snapshot' | 'working-tree'
  readonly repo: string
  readonly commit: string
  readonly entries: SourceEntry[]
  private readonly byPath: Map<string, SourceEntry>
  private readonly textCache = new Map<string, string>()

  constructor(repo: string, ref: string, workingTree = false) {
    this.mode = workingTree ? 'working-tree' : 'snapshot'
    this.repo = realpathSync(repo)
    this.commit = this.git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
      .toString()
      .trim()
    if (!/^[a-f\d]{40}$/.test(this.commit)) throw new Error('A SHA-1 Git commit is required')
    this.entries = this.git(['ls-tree', '-r', '-l', '-z', '--full-tree', this.commit])
      .toString()
      .split('\0')
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf('\t')
        const [mode, kind, blob, size] = line.slice(0, tab).trim().split(/\s+/)
        return {
          path: line.slice(tab + 1),
          mode,
          kind,
          blob,
          bytes: size === '-' ? 0 : Number(size),
        }
      })
      .sort((a, b) => compare(a.path, b.path))
    if (workingTree) this.entries = this.workingEntries()
    this.byPath = new Map(this.entries.map((entry) => [entry.path, entry]))
  }

  /** Include tracked edits, deletions and non-ignored untracked sources without following symlinks. */
  private workingEntries(): SourceEntry[] {
    const files = [
      ...new Set(
        this.git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
          .toString()
          .split('\0')
          .filter(Boolean)
      ),
    ].sort(compare)
    return files.flatMap((file) => {
      const absolute = path.join(this.repo, file)
      let stat: ReturnType<typeof lstatSync>
      try {
        stat = lstatSync(absolute)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      }
      if (stat.isDirectory())
        return [{ path: file, mode: '160000', kind: 'commit', blob: '', bytes: 0 }]
      const mode = stat.isSymbolicLink() ? '120000' : stat.mode & 0o111 ? '100755' : '100644'
      if (!centralInventory(file) && productScope(file) !== 'check' && !typographySource(file))
        return [{ path: file, mode, kind: 'blob', blob: '', bytes: stat.size }]
      if (realpathSync(path.dirname(absolute)) !== path.dirname(absolute))
        throw new Error(`Source has a symlinked parent directory: ${file}`)
      const data = stat.isSymbolicLink()
        ? Buffer.from(readlinkSync(absolute))
        : readFileSync(absolute)
      const blob = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex')
      return [
        {
          path: file,
          mode,
          kind: 'blob',
          blob,
          bytes: data.length,
        },
      ]
    })
  }

  /** Refuse to publish a mixed snapshot when source changes during a local run. */
  assertUnchanged(): void {
    if (
      this.mode === 'working-tree' &&
      JSON.stringify(this.entries) !== JSON.stringify(this.workingEntries())
    )
      throw new Error(
        'Working-tree source changed during the scan; rerun to obtain a consistent report'
      )
  }

  private git(args: string[]): Buffer {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
    )
    try {
      return execFileSync(
        'git',
        ['--no-pager', '--no-replace-objects', '-c', 'core.fsmonitor=false', ...args],
        {
          cwd: this.repo,
          maxBuffer: 128 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...env,
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_OPTIONAL_LOCKS: '0',
          },
        }
      )
    } catch {
      throw new Error(`Read-only Git operation failed: ${args[0]}`)
    }
  }

  read(entry: Entry): string {
    const known = this.byPath.get(entry.path)
    if (!known || known.blob !== entry.blob || !regular(known))
      throw new Error(`Not a regular source blob in the selected commit: ${entry.path}`)
    if (known.bytes > registry.limits.sourceBytes)
      throw new Error(`Source exceeds the 2 MiB parsing limit: ${entry.path}`)
    return this.readOwnership(entry)
  }

  /** Ownership parsing has a separate bounded limit; styling still obeys the 2 MiB cap. */
  readOwnership(entry: Entry): string {
    const known = this.byPath.get(entry.path)
    if (!known || known.blob !== entry.blob || !regular(known))
      throw new Error(`Not a regular source blob in the selected commit: ${entry.path}`)
    if (known.bytes > 16 * 1024 * 1024)
      throw new Error(`Source exceeds the 16 MiB ownership limit: ${entry.path}`)
    const cached = this.textCache.get(known.blob)
    if (cached !== undefined) return cached
    const text = verifiedText(
      this.mode === 'working-tree'
        ? readFileSync(path.join(this.repo, entry.path))
        : this.git(['cat-file', 'blob', known.blob]),
      known.blob
    )
    this.textCache.set(known.blob, text)
    return text
  }

  central(): SystemInput {
    const entries = this.entries.filter((entry) => centralInventory(entry.path))
    if (!entries.some((entry) => entry.path === TOKEN_FILE))
      throw new Error('Required central globals.css is missing')
    for (const entry of entries) {
      if (!regular(entry)) throw new Error(`Central source is not a regular file: ${entry.path}`)
      if (entry.bytes > registry.limits.sourceBytes)
        throw new Error(`Central source exceeds parser limit: ${entry.path}`)
    }
    const inventory = entries.map(({ path, mode, blob }) => ({ path, mode, blob }))
    const recipeInventory = Object.keys(registry.centralRecipes ?? {}).sort(compare)
    return {
      snapshot: {
        version: '1.0.0',
        commit: this.commit,
        entries: inventory,
        recipeInventory,
        hash: snapshotHash(inventory, recipeInventory),
      },
      read: (entry) => this.read(entry),
    }
  }
}

export const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
export const regular = (entry: SourceEntry) =>
  entry.kind === 'blob' && /^100(?:644|755)$/.test(entry.mode)
