#!/usr/bin/env bun
/**
 * Fails if a guarded entry can reach the executable tool registry, or if any
 * entry's module graph grows past its recorded baseline.
 *
 * `@/tools/registry` is a barrel over 4,300+ tools whose `ToolConfig`s hold
 * closures (`request.headers`, `transformResponse`). Those
 * closures reach every integration's SDK client and parser, so reaching the
 * barrel costs ~4,700 modules — it was 71-82% of every workspace route's module
 * graph until those edges were cut.
 *
 * Client-reachable code reads `@/tools/metadata`, `@/tools/metadata-outputs` or
 * `@/tools/tool-ids` instead. See
 * `.agents/skills/tool-registry-boundary/SKILL.md`.
 *
 * This regresses silently and cheaply: any file under a route can import one
 * helper from a module that happens to import `getTool`, and the whole registry
 * comes back. That is exactly how it got there — `providers/utils.ts` pulled it
 * in through `mergeToolParameters`, and `mcp-dynamic-args.tsx` through
 * `formatParameterLabel`. Neither import looks remotely suspicious at the call
 * site, which is why this is a lint and not a convention.
 *
 * The registry is only the loudest instance of the problem. The same walk yields
 * each entry's exact module count, so `--check` additionally ratchets those
 * counts against `check-tool-registry-boundary.baseline.json` (mirroring
 * `check-react-query-patterns.ts`): an entry may not exceed its recorded size by
 * more than `max(25 modules, 2%)`. A regression is reported with the dominator
 * chain that grew — the import edge every one of the new modules must pass
 * through — because a bare number is not actionable.
 *
 * An entry with NO baseline row fails `--check` too. It used to be reported as
 * informational, which meant adding an entry source silently opted its graphs
 * out of the ratchet: seven catalog entries were unratcheted while the summary
 * still read "✓ 41 entry graphs within their module-count baseline". Whatever
 * the summary counts is what is actually enforced.
 *
 * Usage:
 *   bun run scripts/check-tool-registry-boundary.ts            # registry gate only
 *   bun run scripts/check-tool-registry-boundary.ts --check    # + graph-weight ratchet
 *   bun run scripts/check-tool-registry-boundary.ts --verbose  # print counts
 *   bun run scripts/check-tool-registry-boundary.ts --update-baseline
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const APP = join(ROOT, 'apps/sim')

/** Module no client-reachable entry may reach. */
const FORBIDDEN = join(APP, 'tools/registry.ts')

interface EntrySource {
  /** Directory under `apps/sim` the entries are discovered in. */
  root: string
  /** Whether a file inside it counts as an entry. */
  matches: (filename: string, fullPath: string) => boolean
  /** Why this subtree must stay registry-free, printed when the root disappears. */
  reason: string
}

const WORKSPACE_ENTRY_FILENAMES = new Set([
  'page.tsx',
  'layout.tsx',
  'error.tsx',
  'loading.tsx',
  'not-found.tsx',
  'template.tsx',
  'default.tsx',
])

const DEFAULT_EXPORT_RE =
  /(?:^|\n)\s*export\s+default\b|(?:^|\n)\s*export\s*\{[^}]*(?:\bas\s+default\b|\bdefault\s*[,}])/

function hasDefaultExport(file: string): boolean {
  try {
    return DEFAULT_EXPORT_RE.test(readFileSync(file, 'utf8'))
  } catch {
    return false
  }
}

const isWorkspaceEntry = (filename: string, fullPath: string) =>
  WORKSPACE_ENTRY_FILENAMES.has(filename) && hasDefaultExport(fullPath)
const isRouteEntry = (filename: string) => filename === 'route.ts'
const isSourceModule = (filename: string) =>
  filename.endsWith('.ts') && !filename.endsWith('.test.ts')

/**
 * Subtrees the guard walks, each discovered rather than listed file by file.
 * Discovery is what keeps a subtree honest: the first version of this guard
 * named `app/workspace/layout.tsx` as "the shared shell", but that file only
 * wraps `SocketProvider` — the real shell is
 * `app/workspace/[workspaceId]/layout.tsx`, which was never checked. Layouts are
 * enumerated separately from pages because Next.js composes them by convention:
 * a page does not `import` its layout, so walking pages alone never reaches
 * layout modules even though every route pays for them.
 *
 * API routes are covered per subtree rather than wholesale. 122 of the ~1,130
 * route files legitimately reach the registry — every execute, deploy, import,
 * and webhook path runs tools — so a blanket route rule would be an allowlist
 * with 122 entries, which is not a rule. What earns a subtree a place here is
 * that it *serves* tool and block metadata: reading `params`, `outputs`, `name`,
 * or existence is exactly the set `@/tools/metadata` covers, so reaching the
 * registry from one is always a mistake, and one that costs ~4,700 modules of
 * server bundle and cold start per route.
 */
const ENTRY_SOURCES: readonly EntrySource[] = [
  {
    root: 'app/workspace',
    matches: isWorkspaceEntry,
    reason: 'client-reachable workspace convention entries',
  },
  {
    root: 'app/api/v2/blocks',
    matches: isRouteEntry,
    reason: 'the public block catalog, which reads block metadata only',
  },
  {
    root: 'app/api/v2/tools',
    matches: isRouteEntry,
    reason: 'the public tool catalog, which reads tool metadata only',
  },
  {
    root: 'app/api/v2/connector-types',
    matches: isRouteEntry,
    reason: 'the public connector-type catalog',
  },
  {
    /**
     * Every projection module, not a barrel over them. The barrel measured a
     * graph no consumer paid for: all six consumers deep-import, so guarding
     * `index.ts` ratcheted a number nothing could regress. The modules
     * themselves are what surfaces import, so they are what is guarded.
     */
    root: 'lib/catalog/projection',
    matches: isSourceModule,
    reason: 'the shared catalog projection, which every catalog surface imports',
  },
  {
    /**
     * The Copilot block-metadata tool: the reason the shared projection exists.
     * Cutting its registry edge took it from ~6,756 modules to ~1,321, and
     * nothing was holding that win — the tool appeared in no guarded subtree, so
     * a single `getTool` import could have spent all of it silently.
     */
    root: 'lib/mothership/tools/server/blocks',
    matches: (filename) => filename === 'get-blocks-metadata-tool.ts',
    reason: 'the Copilot block-metadata tool, which reads block and tool metadata only',
  },
]

function collectEntries(
  dir: string,
  matches: (filename: string, fullPath: string) => boolean,
  found: string[] = []
): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectEntries(full, matches, found)
    else if (matches(entry.name, full)) found.push(relative(APP, full))
  }
  return found
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

/**
 * Matches value imports and re-exports, skipping `import type` and
 * `export type` — a type-only edge is erased at compile time and costs nothing.
 *
 * `REEXPORT_RE` allows an alias after the star so `export * as ns from` is not
 * missed, and `DYNAMIC_IMPORT_RE` covers `import('…')`. A dynamic import splits
 * the registry into its own chunk rather than the route's initial one, but it
 * still puts 4,300 tools' worth of executable config on a client path, so it
 * counts as reaching it — and the settings route's registry edge hid behind
 * exactly such an import.
 *
 * `REQUIRE_RE` matters for the same reason: this codebase uses lazy
 * `require('@/…')` to break import cycles (`tools/params.ts` reaches `@/blocks`
 * that way), and those edges are as real as static ones.
 *
 * In `IMPORT_RE` the `from` clause is optional AND lazily optional (`??`). A
 * greedy `?` tries to match the clause before trying to skip it, so a bare
 * side-effect import (`import '@/executor'`) was swallowed as the prefix of the
 * *next* statement's `from`: that edge was dropped and the next one attributed to
 * the wrong importer.
 */
const IMPORT_RE = /(?:^|\n)\s*import\s+(?!type\b)(?:[\s\S]*?from\s*)??['"]([^'"]+)['"]/g
const REEXPORT_RE =
  /(?:^|\n)\s*export\s+(?!type\b)(?:\*(?:\s+as\s+[\w$]+)?|\{[\s\S]*?\})\s*from\s*['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g

/** Resolves `@/` and relative specifiers. Bare package specifiers are ignored. */
function resolveSpecifier(specifier: string, importer: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(APP, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(importer), specifier)
  else return null

  // An already-extensioned specifier (`@/tools/registry.ts`) resolves as-is.
  // Probing only `base + ext` would miss it and silently drop the edge — and
  // extensionful `@/` imports do exist in this repo.
  if (existsSync(base) && statSync(base).isFile()) return base

  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext
  }
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const ext of EXTENSIONS) {
      const indexPath = join(base, `index${ext}`)
      if (existsSync(indexPath)) return indexPath
    }
  }
  return null
}

const NO_DEPS: readonly string[] = []

/**
 * Resolved value-import edges out of one file.
 *
 * Memoized across entries: the 34 entries overlap heavily (every route drags in
 * the same shell), so without this each file is re-read and re-scanned once per
 * entry that reaches it. The cache is what pays for the dominator analysis added
 * below — the whole check got faster, not slower.
 */
const depsCache = new Map<string, readonly string[]>()

function depsOf(file: string): readonly string[] {
  const cached = depsCache.get(file)
  if (cached) return cached

  let source: string
  try {
    source = readFileSync(file, 'utf8')
  } catch {
    depsCache.set(file, NO_DEPS)
    return NO_DEPS
  }

  const deps: string[] = []
  const seen = new Set<string>()
  for (const pattern of [IMPORT_RE, REEXPORT_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE]) {
    pattern.lastIndex = 0
    let match = pattern.exec(source)
    while (match !== null) {
      const resolved = resolveSpecifier(match[1], file)
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved)
        deps.push(resolved)
      }
      match = pattern.exec(source)
    }
  }
  depsCache.set(file, deps)
  return deps
}

interface Walk {
  entry: string
  reachable: Set<string>
  importedBy: Map<string, string>
}

/**
 * Breadth-first so `importedBy` records the *shortest* path to each module —
 * a depth-first parent chain reports whatever winding route the stack happened
 * to take, which reads as noise in a failure message.
 */
function walk(entry: string): Walk {
  const reachable = new Set<string>([entry])
  const importedBy = new Map<string, string>()
  const queue = [entry]

  for (let head = 0; head < queue.length; head++) {
    const file = queue[head]
    for (const resolved of depsOf(file)) {
      if (reachable.has(resolved)) continue
      reachable.add(resolved)
      importedBy.set(resolved, file)
      queue.push(resolved)
    }
  }

  return { entry, reachable, importedBy }
}

/** Walks parent links back to the entry so the offending edge is obvious. */
function explainChain({ importedBy }: Walk, target: string): string[] {
  const chain: string[] = []
  let current: string | undefined = target
  while (current) {
    chain.push(relative(ROOT, current))
    current = importedBy.get(current)
  }
  return chain.reverse()
}

export const BASELINE_PATH = join(SCRIPT_DIR, 'check-tool-registry-boundary.baseline.json')

/**
 * A graph may grow by `max(TOLERANCE_MODULES, TOLERANCE_PERCENT%)` before failing.
 *
 * Both halves are needed. A pure percentage lets the 2,186-module workflow route
 * absorb 40 modules while pinning the 263-module upgrade route to 5, which would
 * fail on an ordinary component addition. A pure absolute number is the same
 * trade in reverse. The floor is sized so adding a feature's worth of components
 * and hooks is free, while every regression this guard has actually seen — the
 * `listTables` prefetch at +444, the registry at +4,700 — is far outside it.
 */
const TOLERANCE_MODULES = 25
const TOLERANCE_PERCENT = 2

/** Smallest dominated subtree worth naming as a gateway in the baseline. */
const GATEWAY_MIN_MODULES = 30
/** Gateways recorded per entry, largest first. */
const GATEWAY_LIMIT = 8

export interface BaselineEntry {
  modules: number
  /** Module → number of modules reachable *only* through it. See `gatewaysFor`. */
  gateways: Record<string, number>
}

export interface Baseline {
  generatedFrom: string
  tolerance: { modules: number; percent: number }
  entries: Record<string, BaselineEntry>
}

function allowanceFor(baselineModules: number): number {
  return Math.max(TOLERANCE_MODULES, Math.ceil((baselineModules * TOLERANCE_PERCENT) / 100))
}

interface Dominators {
  /** Immediate dominator of each module; the entry maps to itself. */
  idom: Map<string, string>
  /** Size of each module's dominator subtree — its exclusive cost to this entry. */
  weight: Map<string, number>
}

/**
 * Dominator tree of the entry's import graph (Cooper–Harvey–Kennedy).
 *
 * The point is the weight: a module's dominator-subtree size is exactly how many
 * modules would leave the graph if its incoming edge were cut. That turns "this
 * page gained 444 modules" into "this page gained 444 modules through
 * `lib/table/index.ts`", which names the import to delete.
 *
 * Computed lazily — only for entries that regress, plus every entry during
 * `--update-baseline`.
 */
function dominators({ entry, reachable }: Walk): Dominators {
  const succ = new Map<string, string[]>()
  for (const file of reachable) {
    succ.set(
      file,
      depsOf(file).filter((dep) => reachable.has(dep))
    )
  }

  // Iterative DFS postorder, then reverse it for the RPO numbering the
  // algorithm's `intersect` walks against.
  const postorder: string[] = []
  const visited = new Set<string>([entry])
  const stack: Array<{ node: string; next: number }> = [{ node: entry, next: 0 }]
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    const children = succ.get(frame.node) as string[]
    if (frame.next < children.length) {
      const child = children[frame.next++]
      if (!visited.has(child)) {
        visited.add(child)
        stack.push({ node: child, next: 0 })
      }
    } else {
      postorder.push(frame.node)
      stack.pop()
    }
  }

  const rpo = [...postorder].reverse()
  const rpoIndex = new Map<string, number>()
  rpo.forEach((node, index) => rpoIndex.set(node, index))

  const preds = new Map<string, string[]>()
  for (const [file, children] of succ) {
    if (!rpoIndex.has(file)) continue
    for (const child of children) {
      if (!rpoIndex.has(child)) continue
      const list = preds.get(child)
      if (list) list.push(file)
      else preds.set(child, [file])
    }
  }

  const idom = new Map<string, string>([[entry, entry]])
  const intersect = (a: string, b: string): string => {
    let left = a
    let right = b
    while (left !== right) {
      while ((rpoIndex.get(left) as number) > (rpoIndex.get(right) as number))
        left = idom.get(left) as string
      while ((rpoIndex.get(right) as number) > (rpoIndex.get(left) as number))
        right = idom.get(right) as string
    }
    return left
  }

  let changed = true
  while (changed) {
    changed = false
    for (let i = 1; i < rpo.length; i++) {
      const node = rpo[i]
      let candidate: string | null = null
      for (const pred of preds.get(node) ?? []) {
        if (!idom.has(pred)) continue
        candidate = candidate === null ? pred : intersect(candidate, pred)
      }
      if (candidate !== null && idom.get(node) !== candidate) {
        idom.set(node, candidate)
        changed = true
      }
    }
  }

  // A node's dominator parent always has a smaller RPO index, so folding sizes
  // from the deepest index upward completes every subtree in one pass.
  const weight = new Map<string, number>()
  for (const node of rpo) weight.set(node, 1)
  for (let i = rpo.length - 1; i >= 1; i--) {
    const node = rpo[i]
    const parent = idom.get(node)
    if (!parent || parent === node) continue
    weight.set(parent, (weight.get(parent) as number) + (weight.get(node) as number))
  }

  return { idom, weight }
}

/**
 * The heaviest gateway modules of an entry, collapsed to one per chain.
 *
 * In a pass-through chain `a → b → c` every link dominates the same subtree, so
 * reporting all three says the same thing three times. `weight[idom] > weight + 1`
 * keeps only the topmost link of each chain — the branch point nearest the entry,
 * which is the edge a developer can actually delete.
 */
function gatewaysFor(walkResult: Walk, doms: Dominators): Array<[string, number]> {
  const gateways: Array<[string, number]> = []
  for (const [node, size] of doms.weight) {
    if (node === walkResult.entry || size < GATEWAY_MIN_MODULES) continue
    const parent = doms.idom.get(node)
    if (!parent || parent === node) continue
    if (parent !== walkResult.entry && (doms.weight.get(parent) as number) <= size + 1) continue
    gateways.push([relative(ROOT, node), size])
  }
  gateways.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return gateways.slice(0, GATEWAY_LIMIT)
}

/** Dominator-tree ancestry of a module: the edges every path from the entry crosses. */
function dominatorChain(walkResult: Walk, doms: Dominators, target: string): string[] {
  const chain: string[] = []
  let current = target
  for (let guard = 0; guard < 10_000; guard++) {
    chain.push(relative(ROOT, current))
    if (current === walkResult.entry) break
    const parent = doms.idom.get(current)
    if (!parent || parent === current) break
    current = parent
  }
  return chain.reverse()
}

/**
 * How each discovered entry compares against the recorded baseline.
 *
 * Pure so the ratchet's own policy is testable without walking the repo: which
 * entries are enforced, which grew, and — the half that used to be advisory —
 * which have no recorded row at all.
 */
export interface RatchetVerdict {
  /** Entries actually compared against a recorded row. Only these are enforced. */
  ratcheted: string[]
  /** Entries with no baseline row. Nothing bounds their growth, so this fails. */
  unbaselined: string[]
  /** Entries that grew past their allowance. */
  regressed: string[]
  /** Entries that shrank far enough that the win is worth locking in. */
  shrunk: string[]
  /** Baseline rows whose entry no longer exists. */
  removed: string[]
}

/** Compares discovered entry sizes against the baseline. */
export function ratchetAgainstBaseline(
  sizes: ReadonlyMap<string, number>,
  baseline: Baseline
): RatchetVerdict {
  const verdict: RatchetVerdict = {
    ratcheted: [],
    unbaselined: [],
    regressed: [],
    shrunk: [],
    removed: [],
  }

  for (const [entry, after] of sizes) {
    const before = baseline.entries[entry]
    if (!before) {
      verdict.unbaselined.push(entry)
      continue
    }
    verdict.ratcheted.push(entry)
    const allowance = allowanceFor(before.modules)
    if (after > before.modules + allowance) verdict.regressed.push(entry)
    else if (after < before.modules - allowance) verdict.shrunk.push(entry)
  }

  verdict.removed = Object.keys(baseline.entries).filter((entry) => !sizes.has(entry))
  return verdict
}

/**
 * Whether a verdict fails the build.
 *
 * An unbaselined entry fails for the same reason a regressed one does: an entry
 * nothing measures is an entry that can grow to any size. Treating it as
 * informational is what let seven catalog entries sit outside the ratchet under
 * a "✓ within baseline" summary.
 */
export function ratchetFailed(verdict: RatchetVerdict): boolean {
  return verdict.unbaselined.length > 0 || verdict.regressed.length > 0
}

export function loadBaseline(): Baseline | null {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline
  } catch {
    return null
  }
}

const RERECORD_COMMAND = 'bun run scripts/check-tool-registry-boundary.ts --update-baseline'
const REBASELINE_HINT = `If the growth is intentional, re-record it: ${RERECORD_COMMAND}`

/**
 * Reports a regressed entry by naming the gateways that grew, not just the delta.
 *
 * Baseline gateways are matched by path, so an edge that is new (absent from the
 * baseline) and an edge that got heavier are both surfaced, largest growth first.
 */
function reportRegression(entry: string, walkResult: Walk, before: BaselineEntry, after: number) {
  const allowance = allowanceFor(before.modules)
  console.error(
    `\n❌ ${entry} grew to ${after} modules (baseline ${before.modules}, +${after - before.modules}, allowed +${allowance})`
  )

  const doms = dominators(walkResult)
  const growth = gatewaysFor(walkResult, doms)
    .map(([module, size]) => ({ module, size, delta: size - (before.gateways[module] ?? 0) }))
    .filter((row) => row.delta > 0)
    .sort((a, b) => b.delta - a.delta)

  if (growth.length === 0) {
    console.error(
      '   No single import edge accounts for it — the growth is spread across many small modules.'
    )
    console.error(`   Compare with --verbose to see which entries moved. ${REBASELINE_HINT}`)
    return
  }

  for (const row of growth.slice(0, 3)) {
    console.error(`   +${row.delta} modules reach it only via ${row.module} (${row.size} total):`)
    const chain = dominatorChain(walkResult, doms, join(ROOT, row.module))
    for (const step of chain) console.error(`     ${step}`)
  }
  console.error(`   ${REBASELINE_HINT}`)
}

/**
 * Every entry the guard walks, discovered from {@link ENTRY_SOURCES}.
 *
 * Exits rather than returning short when a source root vanishes or yields
 * nothing: a guard that passes vacuously over the subtree it was written to
 * protect is worse than no guard, because the summary line still says "✓".
 */
export function discoverEntries(): string[] {
  const discovered: string[] = []
  for (const source of ENTRY_SOURCES) {
    const entryRoot = join(APP, source.root)
    if (!existsSync(entryRoot)) {
      console.error(
        `❌ ${source.root} no longer exists — it guarded ${source.reason}. Update ENTRY_SOURCES.`
      )
      process.exit(1)
    }
    const found = collectEntries(entryRoot, source.matches)
    if (found.length === 0) {
      console.error(
        `❌ No entries found under ${source.root}. Refusing to pass vacuously over ${source.reason}.`
      )
      process.exit(1)
    }
    discovered.push(...found)
  }
  return [...new Set(discovered)].sort()
}

function main() {
  const verbose = process.argv.includes('--verbose')
  const check = process.argv.includes('--check')
  const update = process.argv.includes('--update-baseline')
  const failures: string[] = []
  let ratchetFailures = 0
  /** Entries actually compared against a recorded baseline, so the summary cannot overstate it. */
  let ratchetedEntries = 0

  const entries = discoverEntries()

  const walked = new Map<string, Walk>()
  for (const entry of entries) {
    const result = walk(join(APP, entry))
    walked.set(entry, result)
    if (result.reachable.has(FORBIDDEN)) {
      failures.push(entry)
      console.error(`\n❌ ${entry} can reach @/tools/registry via:`)
      for (const step of explainChain(result, FORBIDDEN)) {
        console.error(`     ${step}`)
      }
    } else if (verbose) {
      console.log(`✓ ${entry} — ${result.reachable.size} modules, registry unreachable`)
    }
  }

  if (update) {
    const baseline: Baseline = {
      generatedFrom: `module graphs of every entry under: ${ENTRY_SOURCES.map((source) => source.root).join(', ')}`,
      tolerance: { modules: TOLERANCE_MODULES, percent: TOLERANCE_PERCENT },
      entries: {},
    }
    for (const entry of entries) {
      const result = walked.get(entry) as Walk
      baseline.entries[entry] = {
        modules: result.reachable.size,
        gateways: Object.fromEntries(gatewaysFor(result, dominators(result))),
      }
    }
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
    console.log(
      `✓ Baseline written for ${entries.length} entries: ${relative(ROOT, BASELINE_PATH)}`
    )
    process.exit(failures.length > 0 ? 1 : 0)
  }

  if (check) {
    const baseline = loadBaseline()
    if (!baseline) {
      console.error(
        `\n❌ Missing ${relative(ROOT, BASELINE_PATH)}. Refusing to pass without a ratchet — ` +
          'generate it with --update-baseline.'
      )
      process.exit(1)
    }

    const sizes = new Map(
      entries.map((entry) => [entry, (walked.get(entry) as Walk).reachable.size])
    )
    const verdict = ratchetAgainstBaseline(sizes, baseline)
    ratchetedEntries = verdict.ratcheted.length

    for (const entry of verdict.regressed) {
      reportRegression(
        entry,
        walked.get(entry) as Walk,
        baseline.entries[entry],
        sizes.get(entry) as number
      )
    }

    if (verdict.shrunk.length > 0) {
      console.log(`\nℹ ${verdict.shrunk.length} entr(ies) shrank below baseline:`)
      for (const entry of verdict.shrunk) {
        const before = baseline.entries[entry].modules
        const after = sizes.get(entry) as number
        console.log(`     ${entry}: ${before} → ${after} (−${before - after})`)
      }
      console.log(`   Lock the win in, or it can be spent again: ${RERECORD_COMMAND}`)
    }
    if (verdict.unbaselined.length > 0) {
      console.error(`\n❌ ${verdict.unbaselined.length} entr(ies) are not in the baseline, so`)
      console.error('   nothing ratchets their module graphs — they can grow without bound:')
      for (const entry of verdict.unbaselined) {
        console.error(`     ${entry} (${sizes.get(entry)} modules)`)
      }
      console.error(`   Record them: ${RERECORD_COMMAND}`)
    }
    if (verdict.removed.length > 0) {
      console.log(
        `\nℹ ${verdict.removed.length} baseline entr(ies) no longer exist: ${verdict.removed.join(', ')}`
      )
    }

    if (verdict.regressed.length > 0) {
      console.error(
        `\n${verdict.regressed.length} route(s) exceeded their module-graph baseline by more than max(${TOLERANCE_MODULES}, ${TOLERANCE_PERCENT}%).`
      )
      console.error(
        'Every module in a page graph is parsed and shipped, so this is a real page-weight cost.'
      )
    }

    if (ratchetFailed(verdict)) ratchetFailures = 1
  }

  if (failures.length > 0) {
    console.error(
      `\n${failures.length} entr(ies) reach the executable tool registry, which adds ~4,700 modules to each.`
    )
    console.error(
      'Read the metadata instead: `@/tools/metadata` (params), `@/tools/metadata-outputs`'
    )
    console.error(
      '(outputs), or `@/tools/tool-ids` (existence/resolution). Only code that executes a tool'
    )
    console.error('may import `getTool`. See .agents/skills/tool-registry-boundary/SKILL.md.')
  }

  if (failures.length > 0 || ratchetFailures > 0) process.exit(1)

  console.log(`✓ tool registry stays out of ${entries.length} guarded entry graphs`)
  if (check) console.log(`✓ ${ratchetedEntries} entry graphs within their module-count baseline`)
}

if (import.meta.main) main()
