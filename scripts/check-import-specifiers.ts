#!/usr/bin/env bun
/**
 * Import-specifier hygiene for the two shapes that break Turbopack dev while passing
 * the webpack production build — a divergence CI cannot see, because `next dev` runs
 * Turbopack and `next build` runs webpack.
 *
 * 1. `.js` extension specifiers in TypeScript source.
 *
 *    webpack maps `./errors.js` -> `./errors.ts` via `resolve.extensionAlias`.
 *    Turbopack has no equivalent (vercel/next.js#82945), so the same import is a hard
 *    `Module not found: Can't resolve './errors.js'`. `packages/utils/src/index.ts`
 *    shipped 12 of these; every route whose graph reached the `@sim/utils` barrel 500'd
 *    in dev while CI stayed green. The repo is on `moduleResolution: "bundler"`, so the
 *    extensions were never required in the first place.
 *
 * 2. Bare `@sim/<pkg>` barrel imports when the package publishes a subpath export.
 *
 *    `@sim/utils/helpers` resolves straight to one module. `@sim/utils` pulls the barrel
 *    and everything it re-exports — which is how a single `chunkArray` import reached
 *    the broken specifiers above. Subpath imports are already the documented convention
 *    (CLAUDE.md, "Common Utilities"); this makes the convention enforceable.
 *
 * Usage:
 *   bun run scripts/check-import-specifiers.ts
 *   bun run scripts/check-import-specifiers.ts --verbose
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const SCAN_DIRS = ['apps/sim', 'apps/realtime', 'packages']
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'generated', '.turbo'])

/** Any specifier ending in `.js`/`.jsx`/`.mjs` — relative or aliased. */
const JS_SPECIFIER_RE =
  /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]((?:\.|@\/|@sim\/)[^'"]*\.(?:js|jsx|mjs))['"]/g
/** `import ... from '@sim/pkg'` with no subpath. */
const BARE_SIM_BARREL_RE = /(?:^|\n)\s*import[\s\S]*?from\s*['"](@sim\/[a-z0-9-]+)['"]/g

/**
 * Packages that must be imported by subpath. Opt-in rather than opt-out: `@sim/emcn`,
 * `@sim/desktop-bridge` and friends are barrel-first by design, and flagging them would
 * bury the one rule that matters. `@sim/utils` is subpath-only by documented convention
 * (CLAUDE.md, "Common Utilities") and is the package whose barrel took prod routes down.
 */
const SUBPATH_REQUIRED = new Set(['@sim/utils'])

/**
 * Only source a bundler will compile. Vitest and standalone `bun run` scripts resolve
 * `.js` -> `.ts` on their own, so flagging their specifiers is noise — and a check that
 * cries wolf is a check someone deletes.
 */
function isCompiledSource(full: string, name: string): boolean {
  if (!/\.(ts|tsx)$/.test(name) || name.endsWith('.d.ts')) return false
  if (/\.(test|spec)\.tsx?$/.test(name)) return false
  const rel = relative(ROOT, full)
  return !rel.startsWith('apps/sim/scripts/') && !rel.startsWith('apps/realtime/scripts/')
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full, acc)
    else if (isCompiledSource(full, e.name)) acc.push(full)
  }
  return acc
}

/** Subpath exports a package publishes, e.g. `@sim/utils` -> Set{'id','helpers',...}. */
function subpathExports(pkg: string): Set<string> {
  const name = pkg.replace('@sim/', '')
  const out = new Set<string>()
  try {
    const json = JSON.parse(readFileSync(join(ROOT, 'packages', name, 'package.json'), 'utf8'))
    for (const key of Object.keys(json.exports ?? {})) {
      if (key.startsWith('./')) out.add(key.slice(2))
    }
  } catch {
    /* not a workspace package we can inspect */
  }
  return out
}

interface Violation {
  file: string
  line: number
  specifier: string
  kind: 'js-extension' | 'bare-barrel'
  hint: string
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))
const violations: Violation[] = []
const subpathCache = new Map<string, Set<string>>()

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const lineAt = (idx: number) => src.slice(0, idx).split('\n').length

  JS_SPECIFIER_RE.lastIndex = 0
  let m = JS_SPECIFIER_RE.exec(src)
  while (m !== null) {
    violations.push({
      file: relative(ROOT, file),
      line: lineAt(m.index),
      specifier: m[1],
      kind: 'js-extension',
      hint: `drop the extension: '${m[1].replace(/\.(js|jsx|mjs)$/, '')}'`,
    })
    m = JS_SPECIFIER_RE.exec(src)
  }

  BARE_SIM_BARREL_RE.lastIndex = 0
  m = BARE_SIM_BARREL_RE.exec(src)
  while (m !== null) {
    const pkg = m[1]
    if (SUBPATH_REQUIRED.has(pkg)) {
      if (!subpathCache.has(pkg)) subpathCache.set(pkg, subpathExports(pkg))
      const subs = subpathCache.get(pkg) as Set<string>
      if (subs.size > 0) {
        violations.push({
          file: relative(ROOT, file),
          line: lineAt(m.index),
          specifier: pkg,
          kind: 'bare-barrel',
          hint: `import from a subpath instead, e.g. '${pkg}/${[...subs].sort()[0]}'`,
        })
      }
    }
    m = BARE_SIM_BARREL_RE.exec(src)
  }
}

const verbose = process.argv.includes('--verbose')

if (violations.length === 0) {
  console.log(`✓ check-import-specifiers: ${files.length} files, no risky specifiers`)
  process.exit(0)
}

const byKind = {
  'js-extension': violations.filter((v) => v.kind === 'js-extension'),
  'bare-barrel': violations.filter((v) => v.kind === 'bare-barrel'),
}

if (byKind['js-extension'].length) {
  console.error(`\n✗ ${byKind['js-extension'].length} '.js' specifier(s) in TypeScript source:\n`)
  for (const v of byKind['js-extension']) {
    console.error(`    ${v.file}:${v.line}  '${v.specifier}'`)
    console.error(`        ${v.hint}`)
  }
  console.error(
    "\n  webpack rewrites '.js' -> '.ts' via resolve.extensionAlias; Turbopack does not\n" +
      "  (vercel/next.js#82945). So these build green in CI ('next build' = webpack) and\n" +
      "  hard-fail every dev server ('next dev' = Turbopack) with Module not found.\n" +
      '  This repo uses moduleResolution: "bundler" — the extension is never needed.\n'
  )
}

if (byKind['bare-barrel'].length) {
  console.error(`\n✗ ${byKind['bare-barrel'].length} bare @sim/* barrel import(s):\n`)
  for (const v of byKind['bare-barrel']) {
    console.error(`    ${v.file}:${v.line}  '${v.specifier}'`)
    console.error(`        ${v.hint}`)
  }
  console.error(
    '\n  A barrel import pulls every module the barrel re-exports, so one helper drags in\n' +
      '  the whole package — and any single bad specifier inside it takes the importer down.\n'
  )
}

if (verbose) console.error(`\nscanned ${files.length} files`)
process.exit(1)
