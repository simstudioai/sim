import path from 'node:path'
import { parse as parseJson } from 'jsonc-parser'
import { canonicalJson } from '#design-diff/ast'
import { DependencyGraph } from '#design-diff/dependencies'
import type { Entry, GitReader } from '#design-diff/git'
import { LazySources } from '#design-diff/lazy-source'
import { counted, measured } from '#design-diff/metrics'
import { SemanticValues } from '#design-diff/semantic'
import { contentHash, type IndexStore } from '#design-diff/store'
import type { Config, Data } from '#design-diff/types'

export const scriptPattern = /\.[cm]?[jt]sx?$/
export const assetPattern =
  /\.(?:svg|png|jpe?g|gif|webp|avif|ico|bmp|apng|woff2?|ttf|otf|eot|mp4|webm|mov|pdf|tiff?|heic|lottie|glsl|wgsl|vert|frag)$/i
export const textPattern = /\.(?:[cm]?[jt]sx?|css|scss|sass|less|html?|mdx?|json|vue|svelte)$/

export function infrastructure(file: string, config: Config): boolean {
  return (
    (!file.includes('/') || config.sourceRoots.some((root) => file.startsWith(root))) &&
    config.infrastructure.some((pattern) => new RegExp(pattern).test(file))
  )
}

export function scoped(file: string, config: Config): boolean {
  return (
    config.sourceRoots.some((root) => file.startsWith(root)) &&
    !config.exclude.some((pattern) => new RegExp(pattern).test(file))
  )
}

export class SourceTree {
  readonly entries: Map<string, Entry>
  readonly texts: LazySources
  private readonly observed: Set<string>[] = []
  private readonly probes: Map<string, boolean>[] = []
  private routing: string | undefined
  readonly dependencies = new Map<string, Set<string>>()
  readonly failures = new Set<string>()
  readonly semantics = new SemanticValues()
  private readonly jsonValues = new Map<string, Data>()
  private readonly packages = new Map<string, { root: string; manifest: Record<string, unknown> }>()
  private readonly resolutions = new Map<string, string | undefined>()

  constructor(
    reader: GitReader,
    readonly commit: string,
    readonly config: Config,
    readonly index?: IndexStore
  ) {
    this.entries = reader.tree(commit)
    const entries = [...this.entries.values()].filter(
      (entry) =>
        (scoped(entry.path, config) ||
          infrastructure(entry.path, config) ||
          entry.path === 'package.json' ||
          entry.path === 'bun.lock') &&
        (textPattern.test(entry.path) || entry.path === 'bun.lock')
    )
    const readable = entries.filter((entry) => {
      if (entry.size > config.limits.fileBytes || entry.mode === '120000') {
        this.failures.add(entry.path)
        return false
      }
      return true
    })
    if (readable.reduce((size, entry) => size + entry.size, 0) > config.limits.totalBytes) {
      throw new Error('Source snapshot exceeds the configured total byte limit')
    }
    this.texts = new LazySources(reader, readable, (file) => this.observe(file))
    this.texts.prefetch(
      readable
        .filter((entry) => /(?:^|\/)(?:package|tsconfig[^/]*)\.json$/.test(entry.path))
        .map((entry) => entry.path)
    )
    for (const file of this.texts.keys()) {
      if (!/^(?:apps|packages)\/[^/]+\/package\.json$/.test(file)) continue
      const source = this.texts.get(file)!
      try {
        const manifest = JSON.parse(source)
        if (typeof manifest.name === 'string')
          this.packages.set(manifest.name, { root: path.posix.dirname(file), manifest })
      } catch {
        this.failures.add(file)
      }
    }
  }

  observe(file: string): void {
    for (const reads of this.observed) reads.add(file)
  }

  /** File facts contain unresolved specifiers; resolution is always revision-specific. */
  fact<T>(file: string, kind: string, compute: () => T): T {
    this.observe(file)
    const key = `fact:${kind}:${file}:${this.entries.get(file)?.oid}`
    const cached = this.index?.get<{ value: T; failed: boolean }>(key)
    if (cached) {
      if (cached.failed) this.failures.add(file)
      return cached.value
    }
    counted('facts.computed')
    const value = compute()
    this.index?.put(key, { value, failed: this.failures.has(file) })
    return value
  }

  private queryKey(file: string, kind: string): string {
    this.routing ??= contentHash(
      JSON.stringify([
        [...this.entries].map(([name, entry]) => [
          name,
          entry.mode,
          /(?:^|\/)(?:package|tsconfig[^/]*)\.json$/.test(name) ? entry.oid : null,
        ]),
        this.config,
      ])
    )
    return `query:${kind}:${file}:${this.entries.get(file)?.oid}:${this.routing}`
  }

  querySync<T>(file: string, kind: string, compute: () => T): T {
    const key = this.queryKey(file, kind)
    const cached = this.index?.get<{
      value: T
      reads: [string, string | null][]
      failures: string[]
    }>(key)
    if (cached?.reads.every(([name, oid]) => (this.entries.get(name)?.oid ?? null) === oid)) {
      for (const [name] of cached.reads) this.observe(name)
      for (const name of cached.failures) this.failures.add(name)
      counted('queries.reused')
      return cached.value
    }
    const reads = new Set([file])
    this.observed.push(reads)
    try {
      counted('queries.computed')
      const value = compute()
      this.index?.put(key, {
        value,
        reads: [...reads].sort().map((name) => [name, this.entries.get(name)?.oid ?? null]),
        failures: [...reads].filter((name) => this.failures.has(name)),
      })
      return value
    } finally {
      this.observed.pop()
    }
  }

  complete(): void {
    if (!this.graph) return
    this.index?.complete(this.commit, {
      files: [...this.entries].map(([file, entry]) => ({
        ...entry,
        coverage: this.failures.has(file)
          ? 'unreadable'
          : !scoped(file, this.config) &&
              !infrastructure(file, this.config) &&
              file !== 'package.json' &&
              file !== 'bun.lock'
            ? 'excluded'
            : !/\.(?:[cm]?[jt]sx?|css|html?|mdx?|json|svg|png|jpe?g|gif|webp|avif|ico|bmp|apng|woff2?|ttf|otf|eot|mp4|webm|mov|pdf|tiff?|heic|lottie|glsl|wgsl|vert|frag)$/.test(
                  file
                ) && file !== 'bun.lock'
              ? 'unsupported'
              : 'indexed',
      })),
      dependencies: this.graph?.dependencies ?? new Map(),
      limitations: this.graph?.limitations ?? new Map(),
    })
  }

  /** Record comparison-context reads independently from immutable source dependencies. */
  isAffected(file: string, affected: ReadonlySet<string>): boolean {
    const value = affected.has(file)
    for (const probes of this.probes) probes.set(file, value)
    return value
  }

  /** Reuse a result only while all observed sources and comparison-context probes agree. */
  async query<T>(
    file: string,
    kind: string,
    compute: () => Promise<T>,
    affected: ReadonlySet<string>
  ): Promise<T> {
    const key = this.queryKey(file, kind)
    const cached = this.index?.get<{
      value: T
      reads: [string, string | null][]
      failures: string[]
      probes: [string, boolean][]
    }>(key)
    if (
      cached?.reads.every(([name, oid]) => (this.entries.get(name)?.oid ?? null) === oid) &&
      cached.probes.every(([name, value]) => this.isAffected(name, affected) === value)
    ) {
      for (const [name] of cached.reads) this.observe(name)
      for (const name of cached.failures) this.failures.add(name)
      counted('queries.reused')
      return cached.value
    }
    const reads = new Set([file])
    const probes = new Map<string, boolean>()
    this.observed.push(reads)
    this.probes.push(probes)
    try {
      counted('queries.computed')
      const value = await compute()
      this.index?.put(key, {
        value,
        reads: [...reads].sort().map((name) => [name, this.entries.get(name)?.oid ?? null]),
        failures: [...reads].filter((name) => this.failures.has(name)),
        probes: [...probes].sort(([a], [b]) => a.localeCompare(b, 'en')),
      })
      return value
    } finally {
      this.observed.pop()
      this.probes.pop()
    }
  }

  /** Immutable JSON data is parsed once per revision and never passed to a module loader. */
  json(file: string): Data {
    this.observe(file)
    if (this.jsonValues.has(file)) return this.jsonValues.get(file)!
    const source = this.texts.get(file)
    if (source === undefined) throw new Error('JSON source unavailable')
    const value = canonicalJson(JSON.parse(source))
    this.jsonValues.set(file, value)
    return value
  }

  private candidate(base: string): string | undefined {
    const normalized = path.posix.normalize(base)
    if (normalized.startsWith('../') || normalized.startsWith('/')) return undefined
    for (const suffix of [
      '',
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mts',
      '.mjs',
      '.json',
      '.css',
      '/index.ts',
      '/index.tsx',
      '/index.js',
    ]) {
      if (this.entries.has(normalized + suffix)) return normalized + suffix
    }
    if (/\.[cm]?js$/.test(normalized)) return this.candidate(normalized.replace(/\.[cm]?js$/, ''))
    return undefined
  }

  resolve(from: string, specifier: string): string | undefined {
    this.observe(from)
    const key = `${from}\0${specifier}`
    if (this.resolutions.has(key)) return this.resolutions.get(key)
    const resolved = measured('dependencyResolution', () => this.resolveUncached(from, specifier))
    this.resolutions.set(key, resolved)
    return resolved
  }

  private resolveUncached(from: string, specifier: string): string | undefined {
    if (specifier.startsWith('.'))
      return this.candidate(path.posix.join(path.posix.dirname(from), specifier))
    const root = from.split('/').slice(0, 2).join('/')
    if (specifier.startsWith('/')) return this.candidate(`${root}/public${specifier}`)
    const configText = this.texts.get(`${root}/tsconfig.json`)
    if (configText) {
      const compiler = parseJson(configText)?.compilerOptions
      for (const [pattern, targets] of Object.entries(compiler?.paths ?? {})) {
        const [prefix, suffix = ''] = pattern.split('*')
        if (
          !(pattern.includes('*')
            ? specifier.startsWith(prefix) && specifier.endsWith(suffix)
            : specifier === pattern)
        )
          continue
        if (!Array.isArray(targets)) continue
        for (const target of targets) {
          if (typeof target !== 'string') continue
          const resolved = this.candidate(
            path.posix.join(
              root,
              compiler?.baseUrl ?? '.',
              target.replace(
                '*',
                specifier.slice(prefix.length, suffix ? -suffix.length : undefined)
              )
            )
          )
          if (resolved) return resolved
        }
      }
    }
    for (const alias of this.config.aliases) {
      if (from.startsWith(alias.from) && specifier.startsWith(alias.prefix)) {
        const resolved = this.candidate(alias.target + specifier.slice(alias.prefix.length))
        if (resolved) return resolved
      }
    }
    for (const [name, pkg] of this.packages) {
      if (specifier !== name && !specifier.startsWith(`${name}/`)) continue
      const subpath = specifier === name ? '.' : `.${specifier.slice(name.length)}`
      const exports = pkg.manifest.exports
      const mappings =
        typeof exports === 'string'
          ? { '.': exports }
          : (exports as Record<string, unknown> | undefined)
      for (const [pattern, target] of Object.entries(mappings ?? {})) {
        const [prefix, suffix = ''] = pattern.split('*')
        if (
          !(pattern.includes('*')
            ? subpath.startsWith(prefix) && subpath.endsWith(suffix)
            : subpath === pattern)
        )
          continue
        const value =
          typeof target === 'string'
            ? target
            : target && typeof target === 'object'
              ? ((target as Record<string, unknown>).default ??
                (target as Record<string, unknown>).import ??
                (target as Record<string, unknown>).types)
              : undefined
        if (typeof value === 'string') {
          const resolved = this.candidate(
            path.posix.join(
              pkg.root,
              value.replace('*', subpath.slice(prefix.length, suffix ? -suffix.length : undefined))
            )
          )
          if (resolved) return resolved
        }
      }
      return this.candidate(
        path.posix.join(
          pkg.root,
          subpath === '.'
            ? String(pkg.manifest.module ?? pkg.manifest.main ?? 'src/index')
            : subpath
        )
      )
    }
    return undefined
  }

  graph!: DependencyGraph

  buildGraph(): void {
    this.graph = new DependencyGraph(this, scriptPattern, assetPattern)
    for (const [file, dependencies] of this.graph.dependencies)
      this.dependencies.set(file, dependencies)
  }
}
