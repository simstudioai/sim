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
 *      to it. An id read off `rateLimit`/`auth` is the failure this exists for.
 *   D  at least one governed sink call was actually found. The assertions are
 *      source-text matches, so a refactor into a form the parser cannot follow
 *      would otherwise be indistinguishable from a clean tree.
 *
 * Scope is v1 on purpose. It is the one surface that authorizes in a middleware
 * of its own rather than through `authorizeWorkspaceOperation`, which decides
 * from a `Principal` that has no user to substitute in the first place.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
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

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

const files: string[] = []
walk(join(ROOT, V1_ROOT), files)
const relativeFiles = files.map((file) => relative(ROOT, file)).sort()

const findings: Finding[] = []
let governedSinkCalls = 0

const middlewareSource = readFileSync(join(ROOT, MIDDLEWARE), 'utf8')
if (!new RegExp(`export function ${GOVERNED}\\s*\\(`).test(middlewareSource)) {
  findings.push({
    file: MIDDLEWARE,
    line: 1,
    message:
      `${MIDDLEWARE} no longer exports \`${GOVERNED}\`. Every assertion in this audit is ` +
      'written in terms of it; rename it here and in this script together, or the audit ' +
      'silently stops checking anything.',
  })
}

for (const file of relativeFiles) {
  const source = readFileSync(join(ROOT, file), 'utf8')

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

  /** Locals bound to the governed id, so a call may pass the variable rather than the call. */
  const governedLocals = new Set<string>()
  for (const match of source.matchAll(
    new RegExp(
      `(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=]+)?=\\s*(?:await\\s+)?${GOVERNED}\\(`,
      'g'
    )
  )) {
    governedLocals.add(match[1])
  }

  for (const [sink, subjectIndex] of Object.entries(CAPABILITY_SINKS)) {
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
        governedSinkCalls++
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
