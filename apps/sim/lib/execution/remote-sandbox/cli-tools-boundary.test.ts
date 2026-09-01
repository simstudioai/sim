/**
 * @vitest-environment node
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
])

function simRoot(): string {
  const cwd = process.cwd()
  return existsSync(join(cwd, 'lib/execution/remote-sandbox')) ? cwd : join(cwd, 'apps/sim')
}

function isProductionSourceFile(path: string): boolean {
  if (!SOURCE_EXTENSIONS.has(extname(path))) return false
  return !/\.(?:spec|test|stories)\.[jt]sx?$/.test(path)
}

function listProductionSourceFiles(root: string): string[] {
  const files: string[] = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()
    if (!directory) continue
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) pending.push(path)
      } else if (entry.isFile() && isProductionSourceFile(path)) {
        files.push(path)
      }
    }
  }
  return files.sort()
}

function hasUseClientDirective(source: string): boolean {
  return /^(?:\uFEFF)?\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))\s*)*(['"])use client\1\s*;?/.test(
    source
  )
}

function moduleClauseHasRuntimeValue(clause: string): boolean {
  const normalized = clause.trim()
  if (/^type\b/.test(normalized)) return false
  const named = normalized.match(/^\{([\s\S]*)\}$/)
  if (!named) return true
  return named[1].split(',').some((binding) => !/^type\b/.test(binding.trim()))
}

function runtimeModuleSpecifiers(source: string): string[] {
  const specifiers = new Set<string>()
  const declarationPattern =
    /(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)\s+from\s*(['"])([^'"\n]+)\2/g
  for (const match of source.matchAll(declarationPattern)) {
    if (moduleClauseHasRuntimeValue(match[1])) specifiers.add(match[3])
  }
  const sideEffectPattern = /(?:^|\n)\s*import\s*(['"])([^'"\n]+)\1/g
  for (const match of source.matchAll(sideEffectPattern)) {
    specifiers.add(match[2])
  }
  const dynamicPattern = /\b(?:import|require)\s*\(\s*(['"])([^'"]+)\1\s*\)/g
  for (const match of source.matchAll(dynamicPattern)) {
    specifiers.add(match[2])
  }
  return [...specifiers]
}

function resolveLocalModule(
  importer: string,
  specifier: string,
  root: string,
  sourcePaths: ReadonlySet<string>
): string | null {
  let base: string
  if (specifier.startsWith('@/')) {
    base = resolve(root, specifier.slice(2))
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(importer), specifier)
  } else {
    return null
  }

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    join(base, 'index.js'),
    join(base, 'index.jsx'),
  ]
  return candidates.find((candidate) => sourcePaths.has(candidate)) ?? null
}

function clientPathToServerModule(root: string, target: string): string[] | null {
  const sources = listProductionSourceFiles(root)
  const sourcePaths = new Set(sources)
  const sourceByPath = new Map(sources.map((path) => [path, readFileSync(path, 'utf8')]))
  const clientRoots = sources.filter((path) => hasUseClientDirective(sourceByPath.get(path) ?? ''))
  const parent = new Map<string, string | null>(clientRoots.map((path) => [path, null]))
  const pending = [...clientRoots]
  let pendingIndex = 0

  while (pendingIndex < pending.length) {
    const importer = pending[pendingIndex++]
    if (!importer) continue
    for (const specifier of runtimeModuleSpecifiers(sourceByPath.get(importer) ?? '')) {
      const imported = resolveLocalModule(importer, specifier, root, sourcePaths)
      if (!imported || parent.has(imported)) continue
      parent.set(imported, importer)
      if (imported === target) {
        const path = [imported]
        let cursor: string | null = importer
        while (cursor) {
          path.unshift(cursor)
          cursor = parent.get(cursor) ?? null
        }
        return path
      }
      pending.push(imported)
    }
  }
  return null
}

describe('sandbox CLI client boundary', () => {
  it('keeps provisioning recipes out of every client-reachable module graph', () => {
    const root = simRoot()
    const target = resolve(root, 'lib/execution/remote-sandbox/cli-tools.server.ts')
    const path = clientPathToServerModule(root, target)

    expect(path ? path.map((entry) => entry.slice(root.length + 1)) : null).toBeNull()
  }, 30_000)
})
