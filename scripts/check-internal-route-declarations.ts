#!/usr/bin/env bun
/**
 * Fails when a tool's URL builder returns a bare `/api/...` string.
 *
 * The transport signs internal requests with an internal token for the executing user, so a tool
 * targeting Sim's own API must declare that in its source: a static `request.url` string, or an
 * `internalRoute` template. A builder returning a plain `/api/...` string carries no provenance —
 * a `user-or-llm` param produces exactly the same value — so the transport treats it as external
 * and the tool silently loses its internal routing. This check catches that at authoring time
 * rather than at runtime.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const TOOLS = join(ROOT, 'apps/sim/tools')
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])

/** A `/api/...` string or template literal that is returned rather than declared statically. */
const RETURNED_INTERNAL_PATH = /(?:return|=>)\s*(['"`])(\/api\/)/

interface Violation {
  file: string
  line: number
  text: string
}

function collectSources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'generated') collectSources(path, found)
    } else if (
      SOURCE_EXTENSIONS.has(extname(path)) &&
      !path.endsWith('.test.ts') &&
      !path.endsWith('.d.ts')
    ) {
      found.push(path)
    }
  }
  return found
}

const violations: Violation[] = []

for (const file of collectSources(TOOLS)) {
  const lines = readFileSync(file, 'utf8').split('\n')
  let inUrlBuilder = false
  let builderIndent = 0

  for (const [index, line] of lines.entries()) {
    if (/^\s*url:\s*(\(|async\s*\()/.test(line)) {
      inUrlBuilder = true
      builderIndent = line.match(/^\s*/)![0].length
      // fall through so a single-line builder is checked on this same line
    } else if (inUrlBuilder) {
      const indent = line.match(/^\s*/)![0].length
      const closesBuilder = line.trim() !== '' && indent <= builderIndent && /^\s*[a-z]+:/.test(line)
      if (closesBuilder) inUrlBuilder = false
    }
    if (!inUrlBuilder) continue

    const match = line.match(RETURNED_INTERNAL_PATH)
    if (match) {
      violations.push({ file: relative(ROOT, file), line: index + 1, text: line.trim() })
    }
  }
}

if (violations.length > 0) {
  console.error(
    `\n✗ ${violations.length} tool URL builder(s) return a bare internal path.\n\n` +
      "  Use internalRoute from '@/tools/internal-route' so the route is declared by the tool's\n" +
      '  source, or make the URL a static config string:\n\n' +
      '    url: (params) => internalRoute`/api/table/${params.tableId}/rows`\n'
  )
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}\n    ${violation.text}`)
  }
  process.exit(1)
}

console.log('✓ tool URL builders declare their internal routes')
