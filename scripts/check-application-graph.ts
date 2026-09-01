#!/usr/bin/env bun
/**
 * Asserts the authorization funnel's and the route wrapper's module graphs stay
 * light.
 *
 * `@/lib/core/application` is imported by ~every domain `operations.ts`, and
 * `lib/permission-groups/capabilities.ts` sits below it, so anything either one
 * reaches at runtime is loaded by every surface that authorizes anything —
 * routes, jobs, the realtime prune graph and every use-case unit test. The
 * provider registry, the block/tool registries, the executor and the
 * uploads/workflow graph are all far heavier than an authorization decision,
 * and none of them has anything to say about one.
 *
 * `lib/core/utils/with-route-handler.ts` is guarded on the same principle with a
 * wider list: it wraps every API route, so its graph is loaded by every route
 * and every route test.
 *
 * The edge this guards against is invisible without a check: adding one import
 * to a permission-group helper once widened this graph as far as
 * `lib/uploads/utils/file-utils.ts`, and the only symptom was two unrelated
 * knowledge tests failing on a partial mock of a module they never meant to
 * load. Later, one import in the route wrapper pulled the whole billing graph
 * into every route test, and the only symptom was an unrelated OTP-route test
 * failing on its own partial `zod` mock.
 *
 * Walks `import`/`export … from` specifiers. `import type` is erased by the
 * compiler and costs nothing at runtime, so a type-only edge into a forbidden
 * module is allowed and deliberately not reported. A dynamic `import(…)` is
 * reported when its own target is forbidden but is not walked through — see
 * {@link DYNAMIC_IMPORT_PATTERN} for both halves of that rule.
 *
 * ## Exactly what is guarded, and what is not
 *
 * FIVE entry points, listed in {@link GUARDED_ROOTS}: `lib/core/application`,
 * three permission-group modules (`capabilities`, `capability-assertions`,
 * `config-scope.server`) and the route wrapper. It is NOT "all of
 * `lib/permission-groups/`", and the difference is not a rounding error:
 *
 *  - `lib/permission-groups/model-access.ts` imports `providers/utils.ts`
 *    directly, on purpose — deciding which models a group allows is the one
 *    permission-group question that genuinely needs the provider registry. It is
 *    unguardable by construction, and the graph test uses it as its proof that
 *    the walker can still fail.
 *  - `lib/permission-groups/user-scope.server.ts` — the user-global resolver —
 *    reaches the workflow graph today, through
 *    `lib/billing/organizations/membership.ts` -> `lib/billing/core/usage.ts` ->
 *    `components/emails`. Guarding it is therefore not free: it would go red on
 *    arrival. It is left unguarded rather than added with an exception, because
 *    an exception list is how a root stops meaning anything. What holds it
 *    instead is `check-capability-subject.ts`, which bans a v1 route from
 *    importing it at all.
 *
 * The rule for adding a root is the one the two cases above illustrate: guard an
 * entry point whose graph EVERY authorizing surface pays for, and only while the
 * guard passes without exceptions. A module reached by one gate on one path is
 * not that, however capability-shaped it looks.
 *
 * ## What this audit cannot see
 *
 *  - A specifier that is not a literal — `import(someVariable)`, or a require
 *    built from a template string. There is no call graph here, only source
 *    text.
 *  - Weight that is not a forbidden prefix. A root can reach an arbitrarily
 *    expensive module and stay green if that module is not under one of the
 *    listed trees; the list is a record of what has actually gone wrong, not a
 *    budget.
 *  - Whether a deferred edge is hot or cold. A dynamic import on a per-request
 *    path and one on a once-a-month webhook read identically, which is why the
 *    deferred check stops at the edge's own target rather than walking past it.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const APP_ROOT = resolve(REPO_ROOT, 'apps/sim')

/**
 * Path prefixes no guarded root may reach at runtime, with the reason a reviewer
 * needs to understand the failure without re-deriving this file.
 */
export const FORBIDDEN_PREFIXES: Record<string, string> = {
  'providers/': 'the LLM provider registry — an authorization decision never picks a model',
  'blocks/': 'the block registry — it pulls every block definition into the graph',
  'tools/': 'the executable tool registry — see the tool-registry-boundary skill',
  'executor/': 'the workflow execution engine',
  'lib/uploads/': 'the uploads graph, which reaches file parsing and archive handling',
  'lib/workflows/': 'the workflow graph, which reaches the editor and serializer',
}

/**
 * `withRouteHandler` wraps every API route in the app, so its graph is the one
 * graph *every* route and every route test pays for — a strictly wider blast
 * radius than the authorization funnel's. It is a request-lifecycle wrapper: it
 * stamps a request id, records timings, maps typed errors to statuses, and opens
 * the permission-group memo. It decides nothing about billing, identity, or any
 * domain, so it has no business loading those graphs.
 *
 * These sit on top of FORBIDDEN_PREFIXES for this root only. They are NOT
 * app-wide bans — `lib/permission-groups/resolve.server.ts` legitimately reads
 * the subscription to decide whether an organization is on an enterprise plan,
 * which is why `lib/billing/` stays allowed for the funnel roots below.
 */
const ROUTE_WRAPPER_FORBIDDEN_PREFIXES: Record<string, string> = {
  'lib/billing/': 'the billing graph — the route wrapper makes no plan or subscription decision',
  'lib/permission-groups/resolve.server':
    'the permission-group resolver — the wrapper only opens the memo scope; the resolver ' +
    'belongs to the gate call sites, and it is what dragged billing in',
  'lib/auth': 'the auth graph — the wrapper wraps handlers that authenticate, it does not',
  'lib/copilot/': 'the copilot graph',
  'lib/knowledge/': 'the knowledge-base graph',
}

export interface GuardedRoot {
  /** Path under `apps/sim`. */
  root: string
  forbidden: Record<string, string>
}

/**
 * Entry points whose graph every authorization decision — or, for the route
 * wrapper, every request — pays for.
 */
export const GUARDED_ROOTS: readonly GuardedRoot[] = [
  { root: 'lib/core/application/index.ts', forbidden: FORBIDDEN_PREFIXES },
  { root: 'lib/permission-groups/capabilities.ts', forbidden: FORBIDDEN_PREFIXES },
  { root: 'lib/permission-groups/capability-assertions.ts', forbidden: FORBIDDEN_PREFIXES },
  { root: 'lib/permission-groups/config-scope.server.ts', forbidden: FORBIDDEN_PREFIXES },
  {
    root: 'lib/core/utils/with-route-handler.ts',
    forbidden: { ...FORBIDDEN_PREFIXES, ...ROUTE_WRAPPER_FORBIDDEN_PREFIXES },
  },
]

/**
 * Matches a runtime `import … from '…'` or `export … from '…'`.
 *
 * The negative lookahead drops `import type {` and `import type X`, which the
 * compiler erases; `import { type A }` still counts, because that statement
 * emits a runtime require for the module.
 *
 * The clause between the keyword and `from` never contains a quote, so matching
 * only non-quote characters there keeps this from swallowing a side-effect
 * import that precedes a clause import and reporting one edge for two.
 */
const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(?!type[\s{])[^'"]*?\s*from\s*['"]([^'"]+)['"]/g

/**
 * Matches a side-effect import — `import '…'`, with no clause and so no
 * `from`. It is the heaviest edge of all: the module is loaded purely to run,
 * and nothing in the importing file names it, so it is also the easiest one to
 * miss by eye. It does not match a dynamic `import(…)`: the quote must follow
 * the keyword directly, and a call opens a parenthesis first.
 */
const SIDE_EFFECT_IMPORT_PATTERN = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g

/**
 * Matches a dynamic `import('…')`, which is CHECKED but not TRAVERSED.
 *
 * Checked, because "make it lazy" is the first thing anyone reaches for when
 * this audit goes red, and on the hot path it moves nothing — a helper the
 * funnel calls on every gated request still drags the provider registry in, one
 * request later instead of one import earlier. The pattern is a real one in this
 * repo (see `scripts/generate-block-successors.ts`, which defers the block
 * registry so its unit test need not resolve it), so it is a form the walker has
 * to know about rather than one it can assume absent.
 *
 * Not traversed, because a deferred module's own graph is deferred with it.
 * `lib/billing/core/subscription.ts` — squarely inside the funnel's static graph
 * — lazily loads `@/components/emails` on a plan-upgrade webhook, and that
 * template statically imports the workflow graph. Walking through the deferred
 * hop reports `lib/workflows/schedules/disable-reasons.ts` as an edge every
 * authorization decision pays for, which it is not: nothing loads it until that
 * webhook fires. The edge worth reporting is the deferred one itself, when its
 * TARGET is forbidden.
 *
 * `typeof import('…')` is excluded: that is a type query the compiler erases,
 * the same reason `import type` is dropped above.
 */
const DYNAMIC_IMPORT_PATTERN = /(?<!\btypeof\s{0,16})\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

/** Resolves an `@/`- or relative specifier to a file under `apps/sim`, or null. */
export function resolveSpecifier(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith('@/')
    ? resolve(APP_ROOT, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(fromFile), specifier)
      : null
  if (base === null) return null

  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** The specifiers `source` loads at module evaluation, in source order. */
export function runtimeSpecifiers(source: string): string[] {
  return [...source.matchAll(IMPORT_PATTERN), ...source.matchAll(SIDE_EFFECT_IMPORT_PATTERN)]
    .sort((first, second) => (first.index ?? 0) - (second.index ?? 0))
    .map((match) => match[1])
}

/** The specifiers `source` loads on demand through a dynamic `import(…)` call. */
export function deferredSpecifiers(source: string): string[] {
  return [...source.matchAll(DYNAMIC_IMPORT_PATTERN)].map((match) => match[1])
}

export interface GraphViolation {
  root: string
  forbidden: string
  reason: string
  path: string[]
}

/**
 * Breadth-first walk from `root`, reporting the shortest import chain into each
 * forbidden prefix. Breadth-first on purpose: the shortest chain is the one a
 * reader can act on, and it names the single edge worth deleting.
 */
export function findViolations({ root, forbidden }: GuardedRoot): GraphViolation[] {
  const start = resolve(APP_ROOT, root)
  const violations: GraphViolation[] = []
  const reported = new Set<string>()
  const seen = new Set([start])
  const queue: Array<[string, string[]]> = [[start, [start]]]

  while (queue.length > 0) {
    const [file, path] = queue.shift() as [string, string[]]
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    /**
     * A deferred edge is reported when its target is forbidden and then dropped:
     * the module it names is not loaded until the call runs, so its own graph is
     * not part of what the funnel costs. See {@link DYNAMIC_IMPORT_PATTERN}.
     */
    for (const specifier of deferredSpecifiers(source)) {
      const next = resolveSpecifier(specifier, file)
      if (next === null) continue
      const rel = relative(APP_ROOT, next)
      const prefix = Object.keys(forbidden).find((candidate) => rel.startsWith(candidate))
      if (prefix === undefined || reported.has(prefix)) continue
      reported.add(prefix)
      violations.push({
        root,
        forbidden: rel,
        reason: `${forbidden[prefix]} (reached by a deferred \`import()\`, which defers the load but not the dependency)`,
        path: [...path, next].map((entry) => relative(APP_ROOT, entry)),
      })
    }

    for (const specifier of runtimeSpecifiers(source)) {
      const next = resolveSpecifier(specifier, file)
      if (next === null || seen.has(next)) continue

      const rel = relative(APP_ROOT, next)
      const prefix = Object.keys(forbidden).find((candidate) => rel.startsWith(candidate))
      if (prefix !== undefined) {
        if (!reported.has(prefix)) {
          reported.add(prefix)
          violations.push({
            root,
            forbidden: rel,
            reason: forbidden[prefix],
            path: [...path, next].map((entry) => relative(APP_ROOT, entry)),
          })
        }
        continue
      }

      seen.add(next)
      queue.push([next, [...path, next]])
    }
  }

  return violations
}

function main(): void {
  const violations: GraphViolation[] = []
  for (const guarded of GUARDED_ROOTS) {
    if (!existsSync(resolve(APP_ROOT, guarded.root))) {
      console.error(
        `Application-graph audit could not find its own root '${guarded.root}'.\n` +
          'The module was renamed or moved. Update GUARDED_ROOTS rather than leaving this\n' +
          'audit passing over a file that no longer exists.\n'
      )
      process.exit(1)
    }
    violations.push(...findViolations(guarded))
  }

  if (violations.length > 0) {
    console.error('❌ The authorization funnel reaches modules it must not load at runtime:\n')
    for (const violation of violations) {
      console.error(`  ${violation.forbidden} — ${violation.reason}`)
      console.error(`    ${violation.path.join('\n      -> ')}\n`)
    }
    console.error(
      'Move the code that needs the heavy module out of the funnel, or import it only as a\n' +
        "type. Do not add the module to FORBIDDEN_PREFIXES' exceptions.\n"
    )
    process.exit(1)
  }

  const trees = new Set(GUARDED_ROOTS.flatMap((guarded) => Object.keys(guarded.forbidden)))
  console.log(
    `✅ Application graph clean: ${GUARDED_ROOTS.length} roots reach none of ` +
      `${trees.size} forbidden module trees`
  )
}

if (import.meta.main) main()
