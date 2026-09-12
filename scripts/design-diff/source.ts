import path from 'node:path'
import { parse as parseJson } from 'jsonc-parser'
import { canonicalJson } from '#design-diff/ast'
import { DependencyGraph } from '#design-diff/dependencies'
import type { Entry, GitReader } from '#design-diff/git'
import { SemanticValues } from '#design-diff/semantic'
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
  readonly texts: Map<string, string>
  readonly dependencies = new Map<string, Set<string>>()
  readonly failures = new Set<string>()
  readonly semantics = new SemanticValues()
  private readonly jsonValues = new Map<string, Data>()
  private readonly packages = new Map<string, { root: string; manifest: Record<string, unknown> }>()
  private readonly resolutions = new Map<string, string | undefined>()

  constructor(
    reader: GitReader,
    readonly commit: string,
    readonly config: Config
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
    this.texts = reader.blobs(readable)
    for (const [file, source] of this.texts) {
      if (!/^(?:apps|packages)\/[^/]+\/package\.json$/.test(file)) continue
      try {
        const manifest = JSON.parse(source)
        if (typeof manifest.name === 'string')
          this.packages.set(manifest.name, { root: path.posix.dirname(file), manifest })
      } catch {
        this.failures.add(file)
      }
    }
  }

  /** Immutable JSON data is parsed once per revision and never passed to a module loader. */
  json(file: string): Data {
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
    const key = `${from}\0${specifier}`
    if (this.resolutions.has(key)) return this.resolutions.get(key)
    const resolved = this.resolveUncached(from, specifier)
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
