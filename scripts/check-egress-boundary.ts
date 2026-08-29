#!/usr/bin/env bun
/**
 * Keeps outbound HTTP behind the egress guard.
 *
 * Every request Sim makes to a user- or model-influenced destination has to go
 * through `lib/core/security/egress`, which resolves DNS, classifies each
 * address against the deployment's policy, and pins the connection to the
 * address it approved. A module that reaches for `node:http`, `node:https`, or
 * `undici` directly gets none of that, and the omission is invisible — the code
 * works, it just has no guard.
 *
 * This checks the import edge rather than the call, because that is the part
 * that cannot be hidden behind a helper.
 *
 * Not checked: bare `fetch()`. It is used constantly for same-origin and
 * server-action calls where the guard does not apply, so flagging it would be
 * noise. The transports it can reach are covered by the rules above.
 *
 * Usage: bun run scripts/check-egress-boundary.ts
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')

const SCAN_DIRS = [
  'apps/sim/app',
  'apps/sim/lib',
  'apps/sim/tools',
  'apps/sim/connectors',
  'apps/sim/executor',
  'apps/sim/providers',
  'apps/sim/triggers',
]

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage'])

/** Modules that can open a socket directly. */
const TRANSPORTS = ['http', 'https', 'undici', 'http-proxy-agent', 'https-proxy-agent']

const MODULE_ALTERNATION = TRANSPORTS.map((name) => name.replace(/[-]/g, '\\-')).join('|')
const SPECIFIER = `['"](?:node:)?(?:${MODULE_ALTERNATION})['"]`

/**
 * Every way a module reaches one of these at runtime.
 *
 * Matched against the whole source rather than line by line, because an import
 * list broken across lines would otherwise slip past. `import type` is excluded:
 * a type has no runtime presence and cannot open anything.
 */
const RUNTIME_LOADS: ReadonlyArray<{ pattern: RegExp; kind: string }> = [
  {
    pattern: new RegExp(`^[ \t]*import\\s+(?!type\\s)[\\s\\S]*?from\\s*${SPECIFIER}`, 'gm'),
    kind: 'import',
  },
  { pattern: new RegExp(`^[ \t]*import\\s*${SPECIFIER}`, 'gm'), kind: 'side-effect import' },
  {
    pattern: new RegExp(`^[ \t]*export\\s+(?!type\\s)[\\s\\S]*?from\\s*${SPECIFIER}`, 'gm'),
    kind: 're-export',
  },
  { pattern: new RegExp(`\\bimport\\s*\\(\\s*${SPECIFIER}\\s*\\)`, 'g'), kind: 'dynamic import' },
  { pattern: new RegExp(`\\brequire\\s*\\(\\s*${SPECIFIER}\\s*\\)`, 'g'), kind: 'require' },
]

/**
 * Modules allowed to hold a transport import, each because it *is* part of the
 * guard or predates it for a documented reason.
 */
const ALLOWED = new Set([
  // The guard itself: resolves, classifies, pins, and follows redirects.
  'apps/sim/lib/core/security/input-validation.server.ts',
  // Streaming MCP transport, built on the guard's pinned dispatcher.
  'apps/sim/lib/mcp/pinned-fetch.ts',
  // Builds a dispatcher to carry a caller's deadline; issues no request itself.
  'apps/sim/lib/core/utils/fetch-deadline.ts',
])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

interface Violation {
  file: string
  line: number
  kind: string
  snippet: string
}

function main() {
  const violations: Violation[] = []
  let scanned = 0

  for (const scanDir of SCAN_DIRS) {
    const abs = path.join(ROOT, scanDir)
    for (const file of walk(abs)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      if (ALLOWED.has(rel)) continue
      scanned++
      const source = readFileSync(file, 'utf8')
      for (const { pattern, kind } of RUNTIME_LOADS) {
        pattern.lastIndex = 0
        for (const match of source.matchAll(pattern)) {
          violations.push({
            file: rel,
            line: source.slice(0, match.index).split('\n').length,
            kind,
            snippet: match[0].replace(/\s+/g, ' ').trim(),
          })
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log(`✓ check-egress-boundary: ${scanned} files, no unguarded HTTP transports`)
    process.exit(0)
  }

  console.error('✗ check-egress-boundary: raw HTTP transport outside the egress guard\n')
  for (const violation of violations) {
    console.error(`    ${violation.file}:${violation.line}  (${violation.kind})`)
    console.error(`      ${violation.snippet}`)
  }
  console.error(
    '\n  These modules can open a socket without resolving and classifying the\n' +
      '  destination first, so a user- or model-supplied URL reaches the network\n' +
      '  unchecked. Use secureFetchWithValidation (or secureFetchWithPinnedIP with\n' +
      '  a validated address) from @/lib/core/security/input-validation.server and\n' +
      '  pass the egress profile describing where the URL came from.\n'
  )
  process.exit(1)
}

main()
