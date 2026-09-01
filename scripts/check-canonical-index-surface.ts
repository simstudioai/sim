#!/usr/bin/env bun
/**
 * Asserts that no code decides a canonical group's membership without saying which SURFACE it
 * means.
 *
 * A block that is both an action and a trigger holds ONE `subBlocks` array: its own fields plus
 * its trigger's, spread in after them. The two sets routinely share a `canonicalParamId` under
 * DIFFERENT ids — Webflow's `siteSelector`/`manualSiteId` (action) and `triggerSiteId` (trigger)
 * are all `siteId`. Indexed together they collapse into one group whose `basicId` belongs to the
 * other surface, so the trigger member matches neither `basicId` nor `advancedIds` and every
 * group-relative question about it answers for the dormant surface: the canvas card hid it, the
 * `dependsOn` gate resolved it to a stale action value, and the fork remap classified it a
 * dormant member and CLEARED it.
 *
 * That shipped three separate times, in three subsystems, each found by hand.
 * `buildCanonicalIndexForSurface` makes the correct thing one call, but nothing stopped the next
 * caller from reaching for `blockConfig.subBlocks` again — which is what this audit is for. A
 * site that genuinely means the whole array says so in an annotation, so the reasoning lives at
 * the call instead of being re-derived by the next reader.
 *
 * The two guarded functions declare their surface differently, so each gets the rule that fits:
 *
 * - `buildCanonicalIndex` takes the member set directly, so a first argument reading `.subBlocks`
 *   off a config is unscoped by construction. A call taking an already-narrowed local
 *   (`contextConfigs`, `activeSubBlocks`, a `getCanonicalSubBlocksForSurface` result) is
 *   self-evidently fine and is not flagged.
 * - `createCanonicalModeGates` scopes internally from a trailing `triggerSurface` argument, so
 *   what matters is whether the caller passed one at all — omitting it silently means "action".
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')

/** Placed on the line above a call that deliberately fixes one surface. */
const ANNOTATION = 'canonical-index-unscoped:'

/**
 * Files that hold the guarded names without calling them.
 *
 * `buildCanonicalIndexForSurface` has to call the raw `buildCanonicalIndex`, so its defining
 * module is exempt rather than annotated. This audit's own source carries both names as string
 * literals to search for — without the exemption it flags itself, which is not hypothetical: it
 * passed locally while the file was still untracked and failed the moment it was committed and
 * `git ls-files` started listing it.
 */
const NOT_CALLERS = new Set([
  'apps/sim/lib/workflows/subblocks/visibility.ts',
  'scripts/check-canonical-index-surface.ts',
])

/** The `triggerSurface` argument's position in `createCanonicalModeGates`. */
const GATES_SURFACE_ARG_COUNT = 4

/** Preceding non-empty lines searched for the annotation, matching the repo's other boundary annotations. */
const ANNOTATION_LOOKBACK = 3

interface Offender {
  file: string
  line: number
  detail: string
}

/** The call's top-level arguments, via a balanced scan so a multi-line call still parses. */
function callArguments(source: string, openParenIndex: number): string[] | null {
  const args: string[] = []
  let depth = 0
  let start = openParenIndex + 1
  for (let i = openParenIndex; i < source.length; i++) {
    const char = source[i]
    if (char === '(' || char === '[' || char === '{') depth++
    else if (char === ')' || char === ']' || char === '}') {
      depth--
      if (depth === 0) {
        const tail = source.slice(start, i).trim()
        if (tail.length > 0 || args.length > 0) args.push(tail)
        return args
      }
    } else if (char === ',' && depth === 1) {
      args.push(source.slice(start, i).trim())
      start = i + 1
    }
  }
  return null
}

/**
 * Whether an annotation with a non-empty reason sits on one of the three preceding non-empty
 * lines, matching `check-api-validation-contracts.ts`. Deliberately not "three preceding COMMENT
 * lines": a guarded call inside a multi-line expression (a ternary arm, a chained `Object.values`)
 * is not adjacent to its own comment, and an annotation that cannot be placed is one nobody writes.
 */
function hasAnnotation(lines: string[], line: number): boolean {
  let seen = 0
  for (let i = line - 2; i >= 0 && seen < ANNOTATION_LOOKBACK; i--) {
    const text = lines[i].trim()
    if (text.length === 0) continue
    const at = text.indexOf(ANNOTATION)
    if (at !== -1) return text.slice(at + ANNOTATION.length).trim().length > 0
    seen++
  }
  return false
}

const listed = spawnSync('git', ['ls-files', '-z', '--', '*.ts', '*.tsx'], {
  cwd: ROOT,
  encoding: 'buffer',
  maxBuffer: 256 * 1024 * 1024,
})

if (listed.status !== 0) {
  console.error(`Canonical-index audit failed: \`git ls-files\` exited ${listed.status}.`)
  process.exit(1)
}

const files = listed.stdout
  .toString('utf8')
  .split('\0')
  .filter((entry) => entry.length > 0 && !entry.includes('.test.') && !NOT_CALLERS.has(entry))

const offenders: Offender[] = []
let scanned = 0
let annotated = 0

for (const file of files) {
  const source = await Bun.file(path.join(ROOT, file)).text()
  const hasIndex = source.includes('buildCanonicalIndex(')
  const hasGates = source.includes('createCanonicalModeGates(')
  if (!hasIndex && !hasGates) continue
  const lines = source.split('\n')

  const inspect = (call: string, verdict: (args: string[]) => string | null) => {
    for (const match of source.matchAll(new RegExp(`\\b${call}\\(`, 'g'))) {
      const args = callArguments(source, match.index + match[0].length - 1)
      if (args === null) continue
      scanned++
      const problem = verdict(args)
      if (problem === null) continue
      const line = source.slice(0, match.index).split('\n').length
      if (hasAnnotation(lines, line)) {
        annotated++
        continue
      }
      offenders.push({ file, line, detail: `${call}(…) — ${problem}` })
    }
  }

  if (hasIndex) {
    inspect('buildCanonicalIndex', (args) =>
      /\.subBlocks\b/.test(args[0] ?? '')
        ? `indexes a config's whole \`subBlocks\`: ${(args[0] ?? '').replace(/\s+/g, ' ')}`
        : null
    )
  }
  if (hasGates) {
    inspect('createCanonicalModeGates', (args) =>
      args.length < GATES_SURFACE_ARG_COUNT
        ? `omits the \`triggerSurface\` argument, so it silently gates as the action surface`
        : null
    )
  }
}

if (offenders.length > 0) {
  console.error(
    `Canonical-index surface audit failed: ${offenders.length} call(s) decide canonical group\n` +
      'membership without declaring which surface they mean.\n\n' +
      offenders.map((o) => `  ${o.file}:${o.line}\n    ${o.detail}`).join('\n\n') +
      '\n\n  On a block that is both an action and a trigger, both surfaces live in one `subBlocks`\n' +
      '  array and routinely share a `canonicalParamId` under different ids. Indexed together, a\n' +
      '  trigger field joins the action pair and matches neither side of it — so it gets hidden,\n' +
      "  resolved to the dormant surface's value, or cleared as a dormant member.\n\n" +
      '  Pass the surface — `buildCanonicalIndexForSurface(subBlocks, triggerSurface)`, or the\n' +
      '  trailing argument on `createCanonicalModeGates`. When the surface is provably constant\n' +
      `  at the call, say why instead:\n\n    // ${ANNOTATION} nested tool params are always the action surface\n`
  )
  process.exit(1)
}

console.log(
  `Canonical-index surface audit passed (${scanned} call(s) checked, ${annotated} annotated).`
)
