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
 * noise. The transports it can reach are covered by the import rule above.
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

/**
 * Raw HTTP transports. Reaching one directly bypasses DNS pinning.
 *
 * Matched against the whole source rather than line by line, because an import
 * list broken across lines would otherwise slip past.
 */
const TRANSPORT_IMPORT =
  /^[ \t]*import\b[\s\S]*?from\s*['"](?:node:)?(?:http|https|undici|http-proxy-agent|https-proxy-agent)['"]/gm

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
      TRANSPORT_IMPORT.lastIndex = 0
      for (const match of source.matchAll(TRANSPORT_IMPORT)) {
        const line = source.slice(0, match.index).split('\n').length
        violations.push({
          file: rel,
          line,
          snippet: match[0].replace(/\s+/g, ' ').trim(),
        })
      }
    }
  }

  if (violations.length === 0) {
    console.log(`✓ check-egress-boundary: ${scanned} files, no unguarded HTTP transports`)
    process.exit(0)
  }

  console.error('✗ check-egress-boundary: raw HTTP transport outside the egress guard\n')
  for (const violation of violations) {
    console.error(`    ${violation.file}:${violation.line}`)
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
