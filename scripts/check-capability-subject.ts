#!/usr/bin/env bun
/**
 * Keeps an API key's creator out of every permission-group decision the v1
 * public API makes.
 *
 * A capability belongs to a *person*, so it may only ever be evaluated against a
 * user-bearing principal. `authenticateApiKeyFromHeader` reports a `userId` for
 * BOTH key kinds, and for a workspace key that id is the key's *creator* — a
 * bystander. Asking "does this user's group withhold Tables?" with the creator's
 * id applies one employee's group to every caller of a shared credential, and
 * CLAUDE.md forbids it verbatim: "Never substitute a billing owner, uploader,
 * creator, or API-key owner for the acting principal."
 *
 * The bug has shipped twice and been fixed twice. Both times the fix was to read
 * `keyType` instead of the presence of a user id, and both times nothing stopped
 * the next route from reaching for `rateLimit.userId` again — the raw id sits
 * one property access away from every handler, and it is the right value for the
 * role check, the audit actor and the log line sitting beside the gate. This
 * audit is the thing that stops it.
 *
 * It asserts, over `apps/sim/app/api/v1/**` (excluding `admin/`, the
 * platform-admin surface, and test files):
 *
 *   A  `capabilityGovernedUserId` is still exported from the v1 middleware.
 *      Every other assertion is written in terms of it, so a rename that went
 *      unnoticed would turn this whole audit into a no-op that still passes.
 *   B  no v1 file outside the middleware imports the permission-group modules
 *      directly. A capability decision made at a route reaches for whatever id
 *      is in scope; routing every one through the middleware is what puts it
 *      under assertion C.
 *   C  every call to a capability sink passes a subject that came from
 *      `capabilityGovernedUserId` — the call expression inline, or a local bound
 *      to it — and passes it WITHOUT a fallback. An id read off
 *      `rateLimit`/`auth` is the failure this exists for. Import aliases
 *      (`sink as local`) are folded in, and a local of the audit's own name is
 *      refused outright: either one turns a source-text match into a no-op that
 *      still passes.
 *   D  at least one governed sink call was actually found. The assertions are
 *      source-text matches, so a refactor into a form the parser cannot follow
 *      would otherwise be indistinguishable from a clean tree.
 *
 * The fallback half of C is the one evasion that survived the first version of
 * this audit. `capabilityGovernedUserId(rateLimit) ?? rateLimit.userId` is what
 * a reviewer writes when the governed subject's `null` reads as a gap to be
 * filled — it satisfies the prefix match, it reintroduces the key-creator
 * substitution verbatim, and it used to increment the liveness counter, so the
 * audit reported itself MORE alive for the evasion. Both the inline form and the
 * bound-local form (`const id = capabilityGovernedUserId(x) ?? x.userId`) are
 * findings.
 *
 * Scope is v1 on purpose. It is the one surface that authorizes in a middleware
 * of its own rather than through `authorizeWorkspaceOperation`, which decides
 * from a `Principal` that has no user to substitute in the first place.
 *
 * ## What this audit does not cover
 *
 * - Assertion B bans a fixed list of modules, and `@/lib/logs/log-projection` is
 *   deliberately absent from it: three v1 logs routes import it by design,
 *   because a log FIELD PROJECTION is not a gate the middleware can apply — the
 *   route reads the whole log and blanks fields. `resolveLogFieldProjection` is
 *   on the sink list instead, which is the stronger check of the two: B asks
 *   only whether a module was imported, C asks what subject its sink was given.
 *   A capability decider added under `lib/permission-groups/` belongs on B; one
 *   whose call site is legitimately a route belongs on C.
 * - The sink list is enumerated, not derived. A new helper that takes a user id
 *   and resolves a capability is invisible until it is added to
 *   `CAPABILITY_SINKS` — assertion D catches only the case where EVERY governed
 *   call disappears, not the case where one new ungoverned sink appears beside
 *   them.
 * - `subject` is matched as source text. A subject laundered through a helper
 *   (`subjectFor(rateLimit)`) reads as ungoverned and is reported, which is the
 *   safe direction; a subject laundered through an object property
 *   (`ctx.governed`, assigned from the governed call elsewhere) is also reported.
 *   Neither is followed across files — this audit has no call graph.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `import.meta.url` rather than Bun's `import.meta.dir`, so the module also
 * imports cleanly under vitest — the assertions below are unit-tested, and
 * `import.meta.dir` is undefined outside Bun.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const V1_ROOT = 'apps/sim/app/api/v1'
const MIDDLEWARE = `${V1_ROOT}/middleware.ts`
/** Out of scope: the platform-admin surface authenticates platform admins, not workspace keys. */
const EXCLUDED_DIRECTORIES = ['admin']
const GOVERNED = 'capabilityGovernedUserId'

/**
 * Modules that decide a permission-group capability. A v1 route importing one of
 * these has stepped around the middleware and is deciding for itself.
 */
const CAPABILITY_MODULES = [
  '@/lib/permission-groups/capability-assertions',
  '@/lib/permission-groups/capabilities',
  '@/lib/permission-groups/resolve.server',
  '@/lib/permission-groups/config-scope.server',
  /**
   * The user-global resolver, which answers a capability for a caller who names
   * no workspace by falling back to the organization's default group. It takes
   * a bare `userId` like every other sink, so a v1 route that imported it would
   * be one property access away from the key creator with nothing in between —
   * and being absent from this list is precisely how it would stay green.
   */
  '@/lib/permission-groups/user-scope.server',
]

/**
 * Functions whose named argument IS the person a group governs, by argument
 * index. Add a sink here when one is introduced; a helper that resolves a
 * config or asserts a capability from a user id belongs on this list.
 */
const CAPABILITY_SINKS: Record<string, number> = {
  isCapabilityWithheldForUser: 0,
  isWorkspaceCapabilityWithheld: 0,
  assertWorkspaceCapability: 0,
  resolvePermissionGroupConfig: 0,
  getUserPermissionConfigForOrganization: 0,
  resolveLogFieldProjection: 0,
}

interface Finding {
  file: string
  line: number
  message: string
}

function walk(directory: string, into: string[]): void {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.includes(entry)) walk(full, into)
    } else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) {
      into.push(full)
    }
  }
}

/** Splits a call's argument list on top-level commas, ignoring nested groups and strings. */
function splitArguments(argumentText: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  for (let index = 0; index < argumentText.length; index++) {
    const char = argumentText[index]
    if (quote) {
      if (char === quote && argumentText[index - 1] !== '\\') quote = null
      current += char
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      current += char
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth++
    else if (char === ')' || char === ']' || char === '}') depth--
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/** Text inside the `(...)` that starts at `openIndex`. */
function callArguments(source: string, openIndex: number): string | null {
  let depth = 0
  for (let index = openIndex; index < source.length; index++) {
    const char = source[index]
    if (char === '(') depth++
    else if (char === ')') {
      depth--
      if (depth === 0) return source.slice(openIndex + 1, index)
    }
  }
  return null
}

/**
 * Whether an expression contains a top-level `??` or `||`.
 *
 * `capabilityGovernedUserId(rateLimit) ?? rateLimit.userId` is the natural fix
 * for the null the governed subject returns on a workspace key, and it is the
 * exact substitution this audit exists to stop: the prefix match sees the
 * governed call, the fallback supplies the key creator, and the sink is asked
 * about the creator on every workspace-key request. Nested groups and string
 * bodies are skipped so a `??` inside an argument list is not mistaken for one
 * applied to the subject.
 */
export function hasTopLevelFallback(expression: string): boolean {
  let depth = 0
  let quote: string | null = null
  for (let index = 0; index < expression.length; index++) {
    const char = expression[index]
    if (quote) {
      if (char === quote && expression[index - 1] !== '\\') quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth++
    else if (char === ')' || char === ']' || char === '}') depth--
    else if (
      depth === 0 &&
      ((char === '?' && expression[index + 1] === '?') ||
        (char === '|' && expression[index + 1] === '|'))
    ) {
      return true
    }
  }
  return false
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

/** One v1 source file's findings, so the assertions are testable without a tree on disk. */
export function auditSource(file: string, source: string): { findings: Finding[]; sinks: number } {
  const findings: Finding[] = []
  let sinks = 0

  if (file !== MIDDLEWARE) {
    for (const module of CAPABILITY_MODULES) {
      const index = source.indexOf(`from '${module}'`)
      if (index === -1) continue
      findings.push({
        file,
        line: lineOf(source, index),
        message:
          `imports ${module} directly. A v1 capability decision goes through ` +
          `${MIDDLEWARE}, which resolves its subject with \`${GOVERNED}\` — deciding here ` +
          'reaches for whatever id is in scope, and the id in scope is the key creator.',
      })
    }
  }

  /**
   * Locals bound to the governed id, so a call may pass the variable rather than
   * the call.
   *
   * A binding that falls back — `const id = capabilityGovernedUserId(x) ?? x.userId`
   * — is refused rather than registered: the local then holds the key creator on
   * exactly the requests the governed subject was written to exclude, and every
   * sink taking it would be counted as governed.
   */
  const governedLocals = new Set<string>()
  for (const match of source.matchAll(
    new RegExp(
      `(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=]+)?=\\s*(?:await\\s+)?${GOVERNED}\\(`,
      'g'
    )
  )) {
    const openIndex = match.index + match[0].length - 1
    const argumentText = callArguments(source, openIndex)
    const closeIndex = argumentText === null ? -1 : openIndex + 1 + argumentText.length
    const statementEnd = source.slice(closeIndex + 1).search(/[;\n]/)
    const trailing =
      closeIndex === -1
        ? ''
        : source.slice(
            closeIndex + 1,
            statementEnd === -1 ? undefined : closeIndex + 1 + statementEnd
          )
    if (/^\s*(\?\?|\|\|)/.test(trailing)) {
      findings.push({
        file,
        line: lineOf(source, match.index),
        message:
          `\`${match[1]}\` falls back when \`${GOVERNED}\` names nobody. That null is the ` +
          'answer, not a gap: a workspace API key authorizes as the workspace and its reported ' +
          "user id is the key's creator, so the fallback hands a bystander's permission group to " +
          'every caller of a shared credential — the substitution this audit exists to stop.',
      })
      continue
    }
    governedLocals.add(match[1])
  }

  /**
   * An import alias is a rename the source-text match cannot see:
   * `import { assertWorkspaceCapability as assertCap }` leaves every later call
   * spelled `assertCap(...)`, and the sink's own name still appears once — on
   * the import line — so the audit stayed green with a governed-call count that
   * never moved. Aliases are folded into the sink table for this file.
   */
  const fileSinks = { ...CAPABILITY_SINKS }
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)/g)) {
    const subjectIndex = CAPABILITY_SINKS[match[1]]
    if (subjectIndex !== undefined) fileSinks[match[2]] = subjectIndex
  }

  /**
   * A local of the audit's own name defeats every assertion below at once: the
   * governed-locals scan matches `= capabilityGovernedUserId(` whatever that
   * name now resolves to. Refused outright rather than resolved, because the
   * name has exactly one legitimate meaning here — the middleware's export.
   */
  if (file !== MIDDLEWARE) {
    for (const match of source.matchAll(
      new RegExp(`(?:(?:const|let|var|function)\\s+${GOVERNED}\\b|\\bas\\s+${GOVERNED}\\b)`, 'g')
    )) {
      findings.push({
        file,
        line: lineOf(source, match.index),
        message:
          `declares its own \`${GOVERNED}\`, shadowing the middleware's. Every ` +
          'assertion here is written in terms of that name, so a local one makes a ' +
          'governed subject unverifiable. Import it from the middleware instead.',
      })
    }
  }

  for (const [sink, subjectIndex] of Object.entries(fileSinks)) {
    for (const match of source.matchAll(new RegExp(`\\b${sink}\\s*\\(`, 'g'))) {
      const openIndex = match.index + match[0].length - 1
      /** A declaration or an import of the sink, not a call into it. */
      const preceding = source.slice(Math.max(0, match.index - 40), match.index)
      if (/\b(function|import)\s*$|\bexport\s+(async\s+)?function\s*$/.test(preceding)) continue

      const argumentText = callArguments(source, openIndex)
      if (argumentText === null) continue
      const subject = splitArguments(argumentText)[subjectIndex]
      if (subject === undefined) continue

      const governed =
        subject.startsWith(`${GOVERNED}(`) ||
        subject.startsWith(`await ${GOVERNED}(`) ||
        governedLocals.has(subject)
      if (governed) {
        /**
         * A governed call with a fallback welded to it is worse than an ungoverned
         * one: it reads as the fix, it passes the prefix match, and it used to
         * INCREMENT the liveness counter below — so the evasion made the audit
         * look more alive, not less.
         */
        if (hasTopLevelFallback(subject)) {
          findings.push({
            file,
            line: lineOf(source, match.index),
            message:
              `${sink}(...) is asked about \`${subject}\`, which falls back when ` +
              `\`${GOVERNED}\` names nobody. The null is the answer: a workspace API key has no ` +
              "governed person, and the fallback substitutes the key's creator. Refuse, project, " +
              'or pass the null through — do not replace it.',
          })
          continue
        }
        sinks++
        continue
      }

      findings.push({
        file,
        line: lineOf(source, match.index),
        message:
          `${sink}(...) is asked about \`${subject}\`, which did not come from ` +
          `\`${GOVERNED}\`. A workspace API key reports its creator's user id, so this ` +
          "applies a bystander's permission group to every caller of a shared credential.",
      })
    }
  }

  return { findings, sinks }
}

/** Assertion A: the name every other assertion is written in terms of still exists. */
export function auditMiddlewareExport(middlewareSource: string): Finding[] {
  if (new RegExp(`export function ${GOVERNED}\\s*\\(`).test(middlewareSource)) return []
  return [
    {
      file: MIDDLEWARE,
      line: 1,
      message:
        `${MIDDLEWARE} no longer exports \`${GOVERNED}\`. Every assertion in this audit is ` +
        'written in terms of it; rename it here and in this script together, or the audit ' +
        'silently stops checking anything.',
    },
  ]
}

function main(): void {
  const files: string[] = []
  walk(join(ROOT, V1_ROOT), files)
  const relativeFiles = files.map((file) => relative(ROOT, file)).sort()

  const findings: Finding[] = auditMiddlewareExport(readFileSync(join(ROOT, MIDDLEWARE), 'utf8'))
  let governedSinkCalls = 0

  for (const file of relativeFiles) {
    const result = auditSource(file, readFileSync(join(ROOT, file), 'utf8'))
    findings.push(...result.findings)
    governedSinkCalls += result.sinks
  }

  if (governedSinkCalls === 0 && findings.length === 0) {
    findings.push({
      file: V1_ROOT,
      line: 1,
      message:
        `no call to a capability sink passed through \`${GOVERNED}\` anywhere under ${V1_ROOT}. ` +
        'Either v1 stopped gating capabilities, or it now gates them in a form this audit ' +
        'cannot read — both mean the audit is passing without checking anything.',
    })
  }

  if (findings.length > 0) {
    console.error(
      `check:capability-subject — ${findings.length} finding${findings.length === 1 ? '' : 's'}:\n`
    )
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line}\n    ${finding.message}\n`)
    }
    process.exit(1)
  }

  console.log(
    `check:capability-subject — ${relativeFiles.length} v1 files, ${governedSinkCalls} capability ` +
      `subject${governedSinkCalls === 1 ? '' : 's'} resolved through ${GOVERNED}.`
  )
}

if (import.meta.main) main()
