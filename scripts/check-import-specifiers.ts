#!/usr/bin/env bun
/**
 * Resolves every first-party import specifier the way Turbopack does, and fails on any
 * that does not land on a real file.
 *
 * This exists because `next build` runs webpack and `next dev` runs Turbopack, and the
 * two do not resolve the same set of specifiers. Anything webpack accepts and Turbopack
 * rejects builds green in CI and 500s on every developer's machine — CI cannot see it,
 * because CI never runs the Turbopack graph.
 *
 * The concrete instance: `packages/utils/src/index.ts` addressed its siblings as
 * `./errors.js` while the files are `./errors.ts`. webpack rewrites that through
 * `resolve.extensionAlias`; Turbopack has no equivalent (vercel/next.js#82945). Every
 * route reaching the `@sim/utils` barrel died with
 * `Module not found: Can't resolve './errors.js'`, and the PR that introduced it passed
 * CI clean.
 *
 * Rather than pattern-match that one mistake, this walks the real resolution algorithm
 * with the extensionAlias fallback deliberately absent. That generalises to the whole
 * "Module not found" class: `.js` specifiers, typo'd paths, files moved or deleted with
 * a stale importer left behind, `@/` aliases pointing nowhere, and `@sim/*` subpaths the
 * target package does not actually export.
 *
 * It also keeps one convention rule that resolution cannot express: `@sim/utils` must be
 * imported by subpath. `@sim/utils/helpers` is one module; the bare barrel is twelve, and
 * pulling the barrel is what dragged the broken specifiers above into a route graph.
 *
 * Deliberately NOT checked:
 *   - bare npm specifiers — that is node_modules' business, and `bun install` state makes
 *     it flaky in a way that would train people to ignore this check
 *   - type-only imports — erased before any bundler resolves them
 *   - test files and `apps/*&#47;scripts/**` — vitest and `bun run` resolve `.js` -> `.ts`
 *     themselves, so their specifiers are correct in context; flagging them is noise, and
 *     a check that cries wolf is a check someone deletes
 *
 * Usage:
 *   bun run scripts/check-import-specifiers.ts
 *   bun run scripts/check-import-specifiers.ts --verbose
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const SCAN_DIRS = ['apps/sim', 'apps/realtime', 'apps/docs', 'packages']
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.turbo'])

/**
 * Extensions a bundler probes for an extensionless specifier. `.js` is present because a
 * real `foo.js` next to the importer resolves fine — what does NOT happen is `./foo.js`
 * falling back to `foo.ts`, and that asymmetry is the entire bug this guard exists for.
 */
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']

/** Static value imports and re-exports. `import type` / `export type` are erased. */
const SPECIFIER_RE =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[\s\S]*?from\s*)?['"]([^'"]+)['"]/g
/** `import(...)` — resolved at call time, but the path still has to exist. */
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
/**
 * `require('@/...')` — this repo uses lazy requires deliberately to break import cycles
 * (`tools/params.ts` reaches `@/blocks` that way, `blocks/blocks/agent.ts` reaches
 * `@/blocks/registry`). Those edges resolve exactly like static ones, so a bad specifier
 * in one fails identically and must be checked.
 */
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g

/**
 * Packages that must be imported by subpath. Opt-in rather than opt-out: `@sim/emcn` and
 * `@sim/desktop-bridge` are barrel-first by design, and flagging their 33 call sites would
 * bury the one rule that matters. `@sim/utils` is subpath-only by documented convention
 * (CLAUDE.md, "Common Utilities") and is the package whose barrel took routes down.
 */
const SUBPATH_REQUIRED = new Set(['@sim/utils'])

/** Only source a bundler compiles — see the "Deliberately NOT checked" note above. */
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

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** `<base>`, `<base><ext>`, or `<base>/index<ext>`. */
function probe(base: string): string | null {
  if (isFile(base)) return base
  for (const ext of EXTENSIONS) {
    if (isFile(base + ext)) return base + ext
  }
  for (const ext of EXTENSIONS) {
    const idx = join(base, `index${ext}`)
    if (isFile(idx)) return idx
  }
  return null
}

/**
 * `paths` from the workspace that owns a file, resolved to absolute prefixes.
 *
 * Per-workspace, not global: `@/*` is `apps/sim/*` inside apps/sim but `apps/realtime/src/*`
 * inside apps/realtime, and apps/sim additionally maps `@sim/db/*` straight at the package
 * directory — which legitimately bypasses that package's `exports` map. Resolving with one
 * hardcoded alias reported ~30 false positives against apps/realtime alone.
 */
interface PathRule {
  prefix: string
  suffix: string
  wildcard: boolean
  /** Absolute targets; `*` is retained verbatim and substituted at match time. */
  targets: string[]
}

interface Workspace {
  dir: string
  paths: PathRule[]
}

const workspaces: Workspace[] = []
for (const group of ['apps', 'packages']) {
  let names: string[]
  try {
    names = readdirSync(join(ROOT, group))
  } catch {
    continue
  }
  for (const name of names) {
    const dir = join(ROOT, group, name)
    const tsconfig = join(dir, 'tsconfig.json')
    if (!isFile(tsconfig)) continue
    try {
      const raw = readFileSync(tsconfig, 'utf8').replace(/^\s*\/\/.*$/gm, '')
      const paths = JSON.parse(raw)?.compilerOptions?.paths ?? {}
      const entries: PathRule[] = Object.entries<string[]>(paths).map(([pattern, targets]) => {
        const [prefix, suffix = ''] = pattern.split('*')
        return {
          prefix,
          suffix,
          wildcard: pattern.includes('*'),
          targets: targets.map((t) => resolve(dir, t)),
        }
      })
      // Longest prefix wins, matching TypeScript's own precedence.
      entries.sort((a, b) => b.prefix.length - a.prefix.length)
      workspaces.push({ dir, paths: entries })
    } catch {
      /* unparseable tsconfig — skip rather than fail the whole run */
    }
  }
}
workspaces.sort((a, b) => b.dir.length - a.dir.length)

function workspaceFor(file: string): Workspace | undefined {
  return workspaces.find((w) => file.startsWith(`${w.dir}/`))
}

/** Resolve through the owning workspace's tsconfig `paths`, or null if no pattern matches. */
function resolveViaPaths(spec: string, importer: string): string | null | undefined {
  const ws = workspaceFor(importer)
  if (!ws) return undefined
  for (const { prefix, suffix, wildcard, targets } of ws.paths) {
    if (!spec.startsWith(prefix)) continue
    if (!wildcard) {
      if (spec !== prefix) continue
      for (const t of targets) {
        const hit = probe(t)
        if (hit) return hit
      }
      return null
    }
    if (suffix && !spec.endsWith(suffix)) continue
    const middle = spec.slice(prefix.length, suffix ? spec.length - suffix.length : undefined)
    for (const t of targets) {
      const hit = probe(t.replace('*', middle))
      if (hit) return hit
    }
    return null
  }
  return undefined
}

/** Subpath -> target file, read from a workspace package's `exports` map. */
const pkgExportCache = new Map<string, Map<string, string> | null>()
function packageExports(pkg: string): Map<string, string> | null {
  if (pkgExportCache.has(pkg)) return pkgExportCache.get(pkg) as Map<string, string> | null
  const dir = join(ROOT, 'packages', pkg.replace('@sim/', ''))
  let map: Map<string, string> | null = null
  try {
    const json = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    if (json.name === pkg && json.exports) {
      map = new Map()
      for (const [key, val] of Object.entries<any>(json.exports)) {
        const target = typeof val === 'string' ? val : (val?.default ?? val?.types)
        if (typeof target === 'string') map.set(key, join(dir, target))
      }
    }
  } catch {
    /* not a workspace package, or unreadable */
  }
  pkgExportCache.set(pkg, map)
  return map
}

type Outcome = { ok: true } | { ok: false; reason: string }

function resolveSpecifier(spec: string, importer: string): Outcome | null {
  if (spec.startsWith('.')) {
    return probe(resolve(dirname(importer), spec))
      ? { ok: true }
      : { ok: false, reason: 'no file at that path' }
  }

  // tsconfig `paths` first — it legitimately overrides a package's exports map.
  const viaPaths = resolveViaPaths(spec, importer)
  if (viaPaths) return { ok: true }
  if (viaPaths === null) {
    return {
      ok: false,
      reason: spec.startsWith('@/')
        ? "'@/' alias matches a tsconfig path but nothing is there"
        : 'matches a tsconfig path but nothing is there',
    }
  }

  if (spec.startsWith('@sim/')) {
    const [, name, ...rest] = spec.split('/')
    const pkg = `@sim/${name}`
    const exports = packageExports(pkg)
    if (!exports) return null // package not in packages/, or has no exports map
    const key = rest.length ? `./${rest.join('/')}` : '.'

    const exact = exports.get(key)
    if (exact) {
      return probe(exact) ? { ok: true } : { ok: false, reason: `${key} points at a missing file` }
    }

    // Wildcard subpaths, e.g. `"./*": "./src/*"` on @sim/emcn.
    for (const [pattern, target] of exports) {
      const star = pattern.indexOf('*')
      if (star === -1) continue
      const head = pattern.slice(0, star)
      const tail = pattern.slice(star + 1)
      if (!key.startsWith(head) || !key.endsWith(tail)) continue
      const middle = key.slice(head.length, key.length - tail.length)
      if (probe(target.replace('*', middle))) return { ok: true }
      return { ok: false, reason: `${pkg}'s '${pattern}' export has no file for '${key}'` }
    }

    return { ok: false, reason: `${pkg} does not export '${key}'` }
  }

  return null // bare npm specifier — not ours to verify
}

interface Violation {
  file: string
  line: number
  specifier: string
  kind: 'unresolved' | 'bare-barrel'
  reason: string
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))
const violations: Violation[] = []
let checked = 0

/**
 * Blank out comments while preserving every byte offset, so reported line numbers stay
 * exact. TSDoc routinely contains example imports — `packages/db/triggers.ts` documents
 * `import { ensureRowCountTriggers } from '@sim/db/triggers'`, a subpath the package
 * deliberately does not export — and scanning raw source reports those as broken.
 */
function blankComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length))
}

for (const file of files) {
  const raw = readFileSync(file, 'utf8')
  const src = blankComments(raw)
  let lineStarts: number[] | null = null
  const lineAt = (idx: number) => {
    if (!lineStarts) {
      lineStarts = [0]
      for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1)
    }
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= idx) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  for (const pattern of [SPECIFIER_RE, DYNAMIC_RE, REQUIRE_RE]) {
    pattern.lastIndex = 0
    let m = pattern.exec(src)
    while (m !== null) {
      const spec = m[1]
      /**
       * Anchor to the specifier, not to `m.index`. SPECIFIER_RE opens with `(?:^|\n)`, so
       * `m.index` is the newline ENDING the previous line — reporting it put every violation
       * one line early. The specifier's own offset is exact, and for a multi-line import it
       * points at the `from '...'` line, which is where the reader needs to look anyway.
       */
      const at = m.index + m[0].lastIndexOf(spec)
      const outcome = resolveSpecifier(spec, file)
      if (outcome) {
        checked++
        if (!outcome.ok) {
          violations.push({
            file: relative(ROOT, file),
            line: lineAt(at),
            specifier: spec,
            kind: 'unresolved',
            reason: outcome.reason,
          })
        }
      }
      if (pattern === SPECIFIER_RE && SUBPATH_REQUIRED.has(spec)) {
        const subs = packageExports(spec)
        const example = subs ? [...subs.keys()].find((k) => k !== '.') : undefined
        violations.push({
          file: relative(ROOT, file),
          line: lineAt(at),
          specifier: spec,
          kind: 'bare-barrel',
          reason: example
            ? `import from a subpath instead, e.g. '${spec}${example.slice(1)}'`
            : 'import from a subpath instead',
        })
      }
      m = pattern.exec(src)
    }
  }
}

const verbose = process.argv.includes('--verbose')

if (violations.length === 0) {
  console.log(
    `✓ check-import-specifiers: ${checked} first-party specifiers across ${files.length} files all resolve`
  )
  process.exit(0)
}

const unresolved = violations.filter((v) => v.kind === 'unresolved')
const barrels = violations.filter((v) => v.kind === 'bare-barrel')

if (unresolved.length) {
  console.error(`\n✗ ${unresolved.length} specifier(s) do not resolve:\n`)
  for (const v of unresolved) {
    console.error(`    ${v.file}:${v.line}`)
    console.error(`        '${v.specifier}' — ${v.reason}`)
    if (/\.(js|jsx|mjs)$/.test(v.specifier)) {
      console.error(`        drop the extension: '${v.specifier.replace(/\.\w+$/, '')}'`)
    }
  }
  console.error(
    "\n  These are 'Module not found' at dev time. A '.js' specifier pointing at a '.ts'\n" +
      '  file is the common case: webpack rewrites it via resolve.extensionAlias, Turbopack\n' +
      '  does not (vercel/next.js#82945). CI builds with webpack and every developer runs\n' +
      "  Turbopack, so this class of break is invisible to CI. moduleResolution is 'bundler'\n" +
      '  here — extensions are never required.\n'
  )
}

if (barrels.length) {
  console.error(`\n✗ ${barrels.length} bare barrel import(s) of a subpath-only package:\n`)
  for (const v of barrels) {
    console.error(`    ${v.file}:${v.line}  '${v.specifier}'`)
    console.error(`        ${v.reason}`)
  }
  console.error(
    '\n  A barrel import pulls every module the barrel re-exports, so one helper drags in\n' +
      '  the whole package — and one bad specifier anywhere inside it takes the importer down.\n'
  )
}

if (verbose) console.error(`\nscanned ${files.length} files, ${checked} first-party specifiers`)
process.exit(1)
