/**
 * @vitest-environment node
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DIRECT_GRANT_ENTRY = join(APP_DIR, 'lib/invitations/direct-grant.ts')
const DIRECT_GRANT_EVENT = join(APP_DIR, 'lib/invitations/direct-grant-event.ts')
const AUTH_ENTRY = join(APP_DIR, 'lib/auth/auth.ts')
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'] as const
const IMPORT_PATTERN = /(?:^|\n)\s*import\s+(?!type\b)(?:[\s\S]*?from\s*)?['"]([^'"]+)['"]/g
const REEXPORT_PATTERN =
  /(?:^|\n)\s*export\s+(?!type\b)(?:\*(?:\s+as\s+[\w$]+)?|\{[\s\S]*?\})\s*from\s*['"]([^'"]+)['"]/g

function resolveStaticSpecifier(specifier: string, importer: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(APP_DIR, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(importer), specifier)
  else return null

  if (existsSync(base) && statSync(base).isFile()) return base
  for (const extension of EXTENSIONS) {
    if (existsSync(base + extension)) return base + extension
  }
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const extension of EXTENSIONS) {
      const indexPath = join(base, `index${extension}`)
      if (existsSync(indexPath)) return indexPath
    }
  }
  return null
}

function getStaticDependencies(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const dependencies = new Set<string>()

  for (const pattern of [IMPORT_PATTERN, REEXPORT_PATTERN]) {
    pattern.lastIndex = 0
    let match = pattern.exec(source)
    while (match !== null) {
      const resolved = resolveStaticSpecifier(match[1], file)
      if (resolved) dependencies.add(resolved)
      match = pattern.exec(source)
    }
  }

  return [...dependencies]
}

function findStaticPath(entry: string, target: string): string[] {
  const importedBy = new Map<string, string | null>([[entry, null]])
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.shift() as string
    if (file === target) {
      const path: string[] = []
      let cursor: string | null = file
      while (cursor) {
        path.unshift(relative(APP_DIR, cursor))
        cursor = importedBy.get(cursor) ?? null
      }
      return path
    }

    for (const dependency of getStaticDependencies(file)) {
      if (!importedBy.has(dependency)) {
        importedBy.set(dependency, file)
        queue.push(dependency)
      }
    }
  }

  return []
}

describe('invitation import boundaries', () => {
  it('keeps direct grants out of the auth initialization graph', () => {
    const path = findStaticPath(DIRECT_GRANT_ENTRY, AUTH_ENTRY)
    expect(path, `Unexpected static import path:\n${path.join('\n  -> ')}`).toEqual([])
  })

  it('keeps the direct-grant event contract dependency-free', () => {
    expect(getStaticDependencies(DIRECT_GRANT_EVENT)).toEqual([])
  })
})
