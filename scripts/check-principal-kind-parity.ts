#!/usr/bin/env bun
/**
 * Keeps `personal_api_key` and `oauth_access_token` admitted together in every
 * operation policy.
 *
 * The two kinds are one authorization class: a person reaching the API through
 * a bearer credential of their own. An OAuth access token is the personal key
 * narrowed by scope and bounded by expiry, and `authorizeWorkspaceOperation`
 * walks the same sequence for both. A policy that names one without the other
 * is therefore never a decision — it is an operation written before the second
 * kind existed, or a copy of one, and the token is refused (or admitted) by
 * accident for a reason no reviewer chose.
 *
 * It asserts, over every `application/operations.ts` under `apps/sim/lib`:
 *
 *   A  every `principalKinds` array literal that names one of the pair names
 *      both.
 *   B  at least one policy naming the pair was found. The assertions are
 *      source-text matches, so a refactor into a form this cannot read would
 *      otherwise be indistinguishable from a clean tree.
 *
 * ## What this audit does not cover
 *
 * Read this before trusting the gate: it covers less than it looks like it does.
 *
 * - Only array literals written directly after `principalKinds:` are read. A
 *   policy assembled from a named constant (`principalKinds: HUMAN_KINDS`) is
 *   invisible to assertion A.
 * - Only `operations.ts` files under `apps/sim/lib` are scanned. Anything
 *   declared elsewhere is out of reach.
 * - Nothing here sees a `switch (principal.kind)` or a
 *   `principal.kind === '...'` comparison, which is the class of site that
 *   actually mis-admits a principal silently, and the class this pair had to
 *   be threaded through by hand.
 * - Assertion B proves only that *some* policy names both kinds, not that any
 *   particular domain does. One paired policy anywhere keeps it green.
 *
 * Type-level `readonly principalKinds: readonly [...]` declarations do match
 * the same pattern, so a domain's operation interface is held to the rule.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_ROOT = 'apps/sim/lib'
const OPERATIONS_FILE = 'operations.ts'

/** The pair that must travel together. */
export const USER_CREDENTIAL_PRINCIPAL_KINDS = ['personal_api_key', 'oauth_access_token'] as const

interface Finding {
  file: string
  line: number
  message: string
}

function walk(directory: string, into: string[]): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) walk(full, into)
    else if (entry === OPERATIONS_FILE) into.push(full)
  }
  return into
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

/**
 * Every `principalKinds` array literal in one file, with the kinds it names.
 * Multi-line literals are read to their closing bracket; a literal spread from
 * a constant contributes the spread's text, which never names a bare kind and
 * so never trips assertion A on its own.
 */
export function parsePrincipalKindLiterals(
  source: string
): Array<{ line: number; kinds: string[] }> {
  const literals: Array<{ line: number; kinds: string[] }> = []
  for (const match of source.matchAll(/principalKinds\??:\s*(?:readonly\s+)?\[/g)) {
    const open = match.index + match[0].length - 1
    let depth = 0
    let close = -1
    for (let index = open; index < source.length; index++) {
      const char = source[index]
      if (char === '[') depth++
      else if (char === ']') {
        depth--
        if (depth === 0) {
          close = index
          break
        }
      }
    }
    if (close === -1) continue
    const body = source.slice(open + 1, close)
    const kinds = [...body.matchAll(/'([a-z_]+)'/g)].map((kind) => kind[1])
    literals.push({ line: lineOf(source, match.index), kinds })
  }
  return literals
}

/** One operations file's findings, so the assertion is testable without a tree on disk. */
export function auditSource(file: string, source: string): { findings: Finding[]; pairs: number } {
  const findings: Finding[] = []
  let pairs = 0
  const [personal, oauth] = USER_CREDENTIAL_PRINCIPAL_KINDS

  for (const literal of parsePrincipalKindLiterals(source)) {
    const hasPersonal = literal.kinds.includes(personal)
    const hasOauth = literal.kinds.includes(oauth)
    if (hasPersonal && hasOauth) {
      pairs++
      continue
    }
    if (!hasPersonal && !hasOauth) continue
    const named = hasPersonal ? personal : oauth
    const missing = hasPersonal ? oauth : personal
    findings.push({
      file,
      line: literal.line,
      message:
        `principalKinds names '${named}' without '${missing}'. A personal API key and an OAuth ` +
        'access token are the same authorization class — a person acting through their own ' +
        'bearer credential — so an operation admits both or neither. Add the missing kind.',
    })
  }

  return { findings, pairs }
}

function main(): void {
  const files = walk(join(ROOT, SCAN_ROOT), [])
    .map((file) => relative(ROOT, file))
    .sort()

  const findings: Finding[] = []
  let pairs = 0
  for (const file of files) {
    const result = auditSource(file, readFileSync(join(ROOT, file), 'utf8'))
    findings.push(...result.findings)
    pairs += result.pairs
  }

  if (pairs === 0 && findings.length === 0) {
    findings.push({
      file: SCAN_ROOT,
      line: 1,
      message:
        `no principalKinds literal naming both ${USER_CREDENTIAL_PRINCIPAL_KINDS.join(' and ')} ` +
        `was found under ${SCAN_ROOT}. Either no operation admits user credentials any more, or ` +
        'policies are now written in a form this audit cannot read — both mean it is passing ' +
        'without checking anything.',
    })
  }

  if (findings.length > 0) {
    console.error(
      `check:principal-kind-parity — ${findings.length} finding${findings.length === 1 ? '' : 's'}:\n`
    )
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line}\n    ${finding.message}\n`)
    }
    process.exit(1)
  }

  console.log(
    `check:principal-kind-parity — ${files.length} operations files, ${pairs} policies admit both user-credential kinds.`
  )
}

if (import.meta.main) main()
