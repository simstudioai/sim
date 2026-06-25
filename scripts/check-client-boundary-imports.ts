#!/usr/bin/env bun
/**
 * Guards against the Next.js `'use client'` server-import foot-gun.
 *
 * Next.js rewrites EVERY export of a `'use client'` module into a client
 * reference in the server bundle. Server-evaluated code can only *render* such
 * an export as a component or pass it as a prop — *calling* one throws at
 * runtime ("Attempted to call X from the server but X is on the client"). The
 * crash for an object export looks like `tableKeys.list is not a function`.
 * `next build` does NOT catch this; only SSR/runtime does.
 *
 * This script flags any **value** import (not `import type`) that resolves to a
 * `'use client'` module from a server-evaluated, non-JSX surface — the places
 * that never legitimately render a client component and so only ever import a
 * client module to (illegally) call its values:
 *
 *   - `apps/sim/app/** /prefetch*.ts`      (RSC server prefetch)
 *   - `apps/sim/app/api/** /route.ts(x)`   (route handlers)
 *   - `apps/sim/triggers/**`               (trigger.dev tasks/pollers/webhooks)
 *   - `apps/sim/blocks/**`                  (block definitions — evaluated server-side)
 *
 * Fix: move the imported query-key factory / standalone fetcher / mapper /
 * constant into a non-`'use client'` module (e.g. `hooks/queries/utils/*-keys.ts`
 * or `hooks/queries/utils/fetch-*.ts`) and import it from there. See the rule in
 * `.claude/rules/sim-queries.md`.
 *
 * Escape hatch: `// client-boundary-allow: <reason>` on the line directly above
 * the import (reason required). Use only for a genuinely browser-only code path.
 *
 * Usage:
 *   bun run scripts/check-client-boundary-imports.ts          # report
 *   bun run scripts/check-client-boundary-imports.ts --check  # CI gate (fail on any)
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const APP_DIR = path.join(ROOT, 'apps/sim')

/** Server-evaluated, non-JSX surfaces. A file matches if its path passes one. */
function isServerSurface(rel: string): boolean {
  if (/(^|\/)prefetch[^/]*\.ts$/.test(rel)) return true
  if (/^app\/api\/.+\/route\.tsx?$/.test(rel)) return true
  if (/^triggers\//.test(rel)) return true
  if (/^blocks\//.test(rel)) return true
  return false
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx']
const ALLOW_DIRECTIVE = 'client-boundary-allow'

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      out.push(...(await listFiles(full)))
    } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

const useClientCache = new Map<string, boolean>()

async function isUseClientModule(absFile: string): Promise<boolean> {
  const cached = useClientCache.get(absFile)
  if (cached !== undefined) return cached
  let content: string
  try {
    content = await readFile(absFile, 'utf8')
  } catch {
    useClientCache.set(absFile, false)
    return false
  }
  // The directive must be the first statement (comments/blank lines may precede it).
  let isClient = false
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
      continue
    }
    isClient = line === "'use client'" || line === '"use client"'
    break
  }
  useClientCache.set(absFile, isClient)
  return isClient
}

/** Resolve an import specifier to an absolute source file, or null if external/unresolved. */
async function resolveSpecifier(spec: string, fromFile: string): Promise<string | null> {
  let base: string
  if (spec.startsWith('@/')) {
    base = path.join(APP_DIR, spec.slice(2))
  } else if (spec.startsWith('./') || spec.startsWith('../')) {
    base = path.resolve(path.dirname(fromFile), spec)
  } else {
    return null // external package
  }
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((ext) => base + ext),
    ...SOURCE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ]
  for (const candidate of candidates) {
    if (!SOURCE_EXTENSIONS.includes(path.extname(candidate))) continue
    try {
      await readFile(candidate, 'utf8')
      return candidate
    } catch {}
  }
  return null
}

interface ImportInfo {
  line: number
  specifier: string
  clause: string
}

/** Parse `import ... from '...'` statements, skipping side-effect-only imports. */
function parseImports(content: string): ImportInfo[] {
  const lines = content.split('\n')
  const imports: ImportInfo[] = []
  const re = /^\s*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*import\b/.test(lines[i]) || !lines[i].includes('import')) continue
    // Join up to 12 following lines to capture multi-line import clauses.
    const block = lines.slice(i, i + 12).join('\n')
    const match = re.exec(block)
    if (!match) continue
    imports.push({ line: i + 1, clause: match[1], specifier: match[2] })
  }
  return imports
}

/** True when the import brings in at least one runtime VALUE (not purely types). */
function importsAValue(clause: string): boolean {
  const trimmed = clause.trim()
  if (trimmed.startsWith('type ')) return false // `import type { ... }` / `import type X`
  const braceStart = trimmed.indexOf('{')
  // A default or namespace binding outside the braces is always a value.
  const beforeBrace = braceStart === -1 ? trimmed : trimmed.slice(0, braceStart)
  if (beforeBrace.replace(/[,\s]/g, '').length > 0) return true
  if (braceStart === -1) return true
  const inner = trimmed.slice(braceStart + 1, trimmed.lastIndexOf('}'))
  // A named import is a value unless every member is `type`-prefixed.
  return inner
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((member) => !member.startsWith('type '))
}

function hasAllowDirective(content: string, importLine: number): boolean {
  const lines = content.split('\n')
  for (let i = importLine - 2; i >= 0 && i >= importLine - 5; i--) {
    const line = lines[i]?.trim() ?? ''
    if (line === '' || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) {
      if (line.includes(ALLOW_DIRECTIVE)) {
        const reason =
          line
            .split(ALLOW_DIRECTIVE)[1]
            ?.replace(/^[:\s]+/, '')
            .trim() ?? ''
        return reason.length > 0
      }
      continue
    }
    break
  }
  return false
}

interface Violation {
  file: string
  line: number
  specifier: string
}

async function main() {
  const checkMode = process.argv.includes('--check')
  const allFiles = await listFiles(APP_DIR)
  const violations: Violation[] = []

  for (const absFile of allFiles) {
    const rel = path.relative(APP_DIR, absFile)
    if (!isServerSurface(rel)) continue
    // A server file that is itself `'use client'` is a client component — out of scope.
    if (await isUseClientModule(absFile)) continue

    const content = await readFile(absFile, 'utf8')
    for (const imp of parseImports(content)) {
      if (!importsAValue(imp.clause)) continue
      const resolved = await resolveSpecifier(imp.specifier, absFile)
      if (!resolved) continue
      if (!(await isUseClientModule(resolved))) continue
      if (hasAllowDirective(content, imp.line)) continue
      violations.push({ file: rel, line: imp.line, specifier: imp.specifier })
    }
  }

  if (violations.length === 0) {
    console.log(
      "✓ Client-boundary import check passed (no server file imports a value from a 'use client' module)."
    )
    return
  }

  console.error(
    `\n✗ ${violations.length} server file(s) import a runtime value from a 'use client' module.\n` +
      `  On the server these resolve to client-reference stubs and throw when called (e.g. 'X.list is not a function').\n` +
      `  Move the imported factory/fetcher/constant into a non-'use client' module (hooks/queries/utils/*-keys.ts or fetch-*.ts).\n` +
      `  See .claude/rules/sim-queries.md. Escape hatch: // ${ALLOW_DIRECTIVE}: <reason> above the import.\n`
  )
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  imports from '${v.specifier}'`)
  }
  if (checkMode) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
