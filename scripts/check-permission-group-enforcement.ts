#!/usr/bin/env bun
/**
 * Connects a permission-group config key to the server gate that enforces it.
 *
 * Twelve keys shipped with an admin checkbox, a hint describing what they
 * restrict, and no server check at all — an organization that set
 * `hideCopilot` or `hideDeployChatbot` believed it had withheld a capability
 * while every API route still answered. Nothing connected "this key is offered
 * to admins" to "something refuses when it is set", because the two live in
 * different files and neither knows about the other. This audit connects them.
 *
 * It asserts, in order of what actually goes wrong:
 *
 *   A  every workspace operation declares a capability, or `'none'` with a
 *      reason — an omission cannot be told apart from an unreviewed operation
 *   B  every declared capability exists
 *   C  every capability in the registry is reachable: named by an operation, or
 *      by an annotated call site for the ones the funnel cannot apply
 *   D  every key claiming `enforcement: 'capability'` is read by some rule
 *   E  no key claiming a weaker mechanism is read by one, so a key cannot gain
 *      enforcement while still documented as cosmetic or execution-scoped
 *   F  every member of an exported `*Operations` registry was read by A's
 *      parsers. Everything above can only speak about what they found, and an
 *      operation minted in a form they do not follow yields nothing — which
 *      reads exactly like a clean file
 *
 * A capability the funnel cannot apply — one needing a request value, like an
 * auth mode — is declared at its call site instead:
 *
 *   // permission-group-enforced: deploy.chat.auth_mode — asserted from the use case
 *
 * An operation no group governs says so explicitly:
 *
 *   // permission-group-exempt: <reason>
 *
 * `capability` is a required field on `defineWorkspaceOperation`, so the half of
 * assertion A that asks whether an operation declared one cannot fail through
 * the type system. It survives because this audit reads source text rather than
 * the type: an operation written in a form the parsers cannot follow yields no
 * capability, and without the check it would be skipped in silence — counted as
 * reviewed while nothing had actually read what it declares.
 *
 * ## What "enforced" means here, and where it stops
 *
 * Two different strengths of evidence sit behind assertion C, and the printed
 * total does not distinguish them:
 *
 *  - A capability NAMED BY AN OPERATION is enforced by construction. The funnel
 *    applies it; the declaration and the gate are the same fact.
 *  - A capability reachable only through a `permission-group-enforced:` comment
 *    is enforced by ASSERTION OF THE AUTHOR. This audit matches the comment
 *    text; it does not verify that anything below it gates. Today that is 18 of
 *    35 capabilities — among them `logs.cost`, `inbox.use`, `personal_api_key.use`
 *    and `copilot.tool_auto_approval` — so it is the majority of the registry,
 *    not a rounding error. {@link parseEnforcedAnnotations} records which cheap
 *    lookahead shapes were measured against the tree and why each is wrong more
 *    often than right; closing this properly wants a call graph. What still
 *    holds is narrow but real: deleting a gate AND its comment is reported by C
 *    immediately, and assertion E stops an annotation from inventing enforcement
 *    for a key whose field says `ui-only` or `executor`. The uncovered case is
 *    exactly one — a gate deleted while its comment is left behind.
 *
 * {@link SCAN_ROOTS} is the other boundary. `background/`, `connectors/`,
 * `tools/`, `enrichments/`, `triggers/` and every `.tsx` are unscanned, and as
 * of this writing each contains ZERO operation declarations and ZERO capability
 * gate calls — checked, not assumed. The boundary is documented rather than
 * widened because a scan root that finds nothing costs walk time and teaches a
 * reader that operations might live there. If one ever does, two things change
 * together: `SCAN_ROOTS`, and the `.ts`-only filter in `walk`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
/**
 * Where a `defineWorkspaceOperation` can live. Every operation declared today is
 * under one of these, and `.tsx` is excluded because an operation is policy data
 * that no component declares. Both are deliberate rather than incidental: an
 * operation landing in `background`, `tools`, `triggers`, `connectors` or
 * `enrichments`, or in a `.tsx`, would be invisible here — so widen this list
 * (and `walk`) at the same time as moving one, not afterwards.
 */
const SCAN_ROOTS = ['apps/sim/lib', 'apps/sim/app', 'apps/sim/ee', 'apps/sim/executor']
const CAPABILITIES_FILE = 'apps/sim/lib/permission-groups/capabilities.ts'
const FIELDS_FILE = 'apps/sim/lib/permission-groups/fields.ts'
const ENFORCED_ANNOTATION = 'permission-group-enforced:'
const EXEMPT_ANNOTATION = 'permission-group-exempt:'
const MAX_ANNOTATION_LOOKBACK = 3

/**
 * The naming convention every operation-minting builder follows:
 * `defineWorkspaceOperation`, `defineOperation`, and each domain's own
 * `define<Domain>Operation`.
 *
 * The audit used to look for `defineWorkspaceOperation` and nothing else, so a
 * domain that minted operations through a builder of its own — an object frozen
 * by hand rather than passed to the shared one — was read by neither the
 * builder's definition-time guard nor this script. Twenty-one operations across
 * six domains were invisible that way, and the failure was silent: the files
 * were scanned, some other operation in them was counted, and the audit printed
 * a tick. Matching the family rather than the one name is what makes a new
 * builder visible by default instead of on purpose.
 */
const MINTING_NAME = /^define[A-Za-z0-9_$]*Operation$/
/**
 * A factory parameter that admits a `Partial<…>` override of the operation it
 * mints — `overrides?: Partial<WorkspaceOperation>` and its relatives.
 *
 * The capability this audit reads is the one written in the factory body or at
 * the call site. A parameter spread over the result afterwards can replace it,
 * including with `'none'`, and the audit would keep reporting whatever the
 * literal said — a green tick over an operation whose capability is decided by
 * whoever calls it. No factory in the tree does this today; the point of
 * refusing it here is that the first one to try is reported rather than
 * discovered later.
 *
 * `Partial` and not `Omit`/`Pick`: those narrow a type, they do not make a
 * declared field optional to overwrite.
 */
const OVERRIDE_PARAMETER = /\bPartial\s*<[^>]*Operation\b/
const MINTING_CALL_SOURCE = String.raw`\b(define[A-Za-z0-9_$]*Operation)\s*\(`
const mintingCallPattern = () => new RegExp(MINTING_CALL_SOURCE, 'g')
/** Whether a module mints an operation at all, so files that do not are skipped cheaply. */
const MINTS_AN_OPERATION = new RegExp(MINTING_CALL_SOURCE)
/** An exported `*Operations` registry object, the second route by which operations reach a surface. */
const OPERATION_REGISTRY =
  /(?:^|\n)\s*export const ([A-Za-z0-9_$]+Operations)\s*(?::[^=\n]*)?=\s*\{/g
const DECLARES_A_REGISTRY = /(?:^|\n)\s*export const [A-Za-z0-9_$]+Operations\s*(?::[^=\n]*)?=\s*\{/

interface Finding {
  file: string
  line?: number
  message: string
}

/** The 1-based line `index` falls on. */
function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

const CLOSING: Record<string, string> = { '(': ')', '{': '}', '[': ']' }

/** Text of the balanced `(...)`, `{...}` or `[...]` group that starts at `openIndex`. */
function balancedGroup(source: string, openIndex: number): string {
  const open = source[openIndex]
  const close = CLOSING[open]
  let depth = 0
  for (let index = openIndex; index < source.length; index++) {
    const char = source[index]
    if (char === open) depth++
    else if (char === close) {
      depth--
      if (depth === 0) return source.slice(openIndex, index + 1)
    }
  }
  return source.slice(openIndex)
}

function walk(directory: string, into: string[]): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) walk(full, into)
    else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) into.push(full)
  }
  return into
}

/** The capability ids the registry declares, in declaration order. */
export function parseCapabilityIds(source: string): string[] {
  const start = source.indexOf('CAPABILITY_IDS = [')
  if (start === -1) return []
  const group = balancedGroup(source, source.indexOf('[', start))
  return [...group.matchAll(/'([a-z0-9_.]+)'/g)].map((match) => match[1])
}

/** Each capability's rule kind and the config keys it reads. */
export function parseCapabilityRules(
  source: string
): Map<string, { kind: string; configKeys: string[] }> {
  const rules = new Map<string, { kind: string; configKeys: string[] }>()
  const start = source.indexOf('CAPABILITY_RULES = {')
  if (start === -1) return rules

  const body = balancedGroup(source, source.indexOf('{', start))
  const entryPattern = /'([a-z0-9_.]+)'\s*:\s*\{/g
  for (let match = entryPattern.exec(body); match; match = entryPattern.exec(body)) {
    const entry = balancedGroup(body, body.indexOf('{', match.index + match[0].length - 1))
    const kind = /kind\s*:\s*'([a-z]+)'/.exec(entry)?.[1] ?? ''
    const keysGroup = /configKeys\s*:\s*\[([^\]]*)\]/.exec(entry)?.[1] ?? ''
    const configKeys = [...keysGroup.matchAll(/'([A-Za-z0-9_]+)'/g)].map((key) => key[1])
    rules.set(match[1], { kind, configKeys })
  }
  return rules
}

/** Each config key's declared enforcement, from the field registry. */
export function parseFieldEnforcement(source: string): Map<string, string> {
  const enforcement = new Map<string, string>()
  const start = source.indexOf('PERMISSION_GROUP_FIELDS = {')
  if (start === -1) return enforcement

  const body = balancedGroup(source, source.indexOf('{', start))
  const entryPattern =
    /(?:^|\n)\s{2}([A-Za-z0-9_]+)\s*:\s*(allowlist|denylist|booleanRestriction)\(/g
  for (let match = entryPattern.exec(body); match; match = entryPattern.exec(body)) {
    const call = balancedGroup(body, body.indexOf('(', match.index + match[0].length - 1))
    const declared = /'(capability|executor|ui-only)'/.exec(call)?.[1]
    if (declared) enforcement.set(match[1], declared)
  }
  return enforcement
}

interface OperationDeclaration {
  id: string
  line: number
  capability: string | undefined
}

interface ParsedOperations {
  declarations: OperationDeclaration[]
  /**
   * Lines of same-file factories whose parameters admit a `Partial<…>` override
   * of the operation itself. See {@link OVERRIDE_PARAMETER}.
   */
  overridable: number[]
  /**
   * Lines of operation-minting calls this parser could not read an id from,
   * and which no recognized factory accounts for.
   *
   * A call whose `id` is a const reference, or one minted by a wrapper written
   * as an arrow const rather than a `function`, used to be dropped in silence —
   * the operation simply stopped being counted, and the audit still printed a
   * tick. Reported instead, because an audit that quietly stops watching a
   * domain is the failure it exists to prevent.
   */
  unreadable: number[]
}

/**
 * Every operation minted in a module and the capability it declares, resolved
 * through a same-file factory when a domain wraps a builder (the table
 * operations take only an id and a capability).
 */
export function parseOperationCapabilities(source: string): ParsedOperations {
  const declarations: OperationDeclaration[] = []
  const unreadable: number[] = []
  const overridable: number[] = []

  /**
   * Domains that wrap a builder in a same-file factory declare the capability
   * one of three ways: fixed in the factory body, when every operation it makes
   * belongs to one capability; taken as a second argument when they differ; or
   * passed straight through from an object literal at the call site. The first
   * two are read from their call sites below, the third by the direct scan,
   * which reads the literal exactly as it reads a builder's own.
   */
  const factoryCapabilities = new Map<string, string | 'positional'>()
  const factoryRanges: Array<[number, number]> = []
  const factoryPattern = /(?:^|\n)\s*(?:export\s+)?function\s+([A-Za-z0-9_$]+)\s*[<(]/g
  for (let match = factoryPattern.exec(source); match; match = factoryPattern.exec(source)) {
    const bodyIndex = source.indexOf('{', match.index + match[0].length - 1)
    if (bodyIndex === -1) continue
    const body = balancedGroup(source, bodyIndex)
    if (!MINTS_AN_OPERATION.test(body) && !MINTING_NAME.test(match[1])) continue
    factoryRanges.push([bodyIndex, bodyIndex + body.length])
    const parameterIndex = source.indexOf('(', match.index + match[0].length - 1)
    if (parameterIndex !== -1 && parameterIndex < bodyIndex) {
      const parameters = balancedGroup(source, parameterIndex)
      if (OVERRIDE_PARAMETER.test(parameters)) overridable.push(lineAt(source, match.index))
    }
    const fixed = /capability\s*:\s*'([a-z0-9_.]+)'/.exec(body)?.[1]
    if (fixed) factoryCapabilities.set(match[1], fixed)
    else if (/[,{]\s*capability(?:\s*[,}]|\s*:\s*capability\b)/.test(body))
      factoryCapabilities.set(match[1], 'positional')
  }

  /** A call inside a recognized factory takes its id from a parameter; its call sites are read below. */
  const insideFactory = (index: number) =>
    factoryRanges.some(([start, end]) => index >= start && index < end)

  /**
   * Ranges of calls already read. A domain wrapper such as
   * `defineCredentialOperation(defineWorkspaceOperation({...}), 'admin')` matches
   * twice over one operation; the outer match already carries the inner's `id`
   * and `capability`, so the nested one is skipped rather than counted again.
   */
  const accepted: Array<[number, number]> = []

  const directPattern = mintingCallPattern()
  for (let match = directPattern.exec(source); match; match = directPattern.exec(source)) {
    const name = match[1]
    if (/\bfunction\s+$/.test(source.slice(Math.max(0, match.index - 16), match.index))) continue
    if (factoryCapabilities.has(name)) continue
    if (insideFactory(match.index)) continue
    const openIndex = source.indexOf('(', match.index)
    if (accepted.some(([start, end]) => openIndex > start && openIndex < end)) continue
    const call = balancedGroup(source, openIndex)
    accepted.push([openIndex, openIndex + call.length])
    const id = /id\s*:\s*'([^']+)'/.exec(call)?.[1]
    if (!id) {
      unreadable.push(lineAt(source, match.index))
      continue
    }
    declarations.push({
      id,
      line: lineAt(source, match.index),
      capability: /capability\s*:\s*'([a-z0-9_.]+)'/.exec(call)?.[1],
    })
  }

  for (const [factory, capability] of factoryCapabilities) {
    const callPattern =
      capability === 'positional'
        ? new RegExp(`\\b${factory}\\s*\\(\\s*'([^']+)'\\s*,\\s*'([a-z0-9_.]+)'`, 'g')
        : new RegExp(`\\b${factory}\\s*\\(\\s*'([^']+)'`, 'g')
    for (let match = callPattern.exec(source); match; match = callPattern.exec(source)) {
      if (insideFactory(match.index)) continue
      declarations.push({
        id: match[1],
        line: lineAt(source, match.index),
        capability: capability === 'positional' ? match[2] : capability,
      })
    }
  }

  return { declarations, unreadable, overridable }
}

export interface OperationRegistryMember {
  registry: string
  member: string
  startLine: number
  endLine: number
}

/** Index just past the string literal that starts at `openIndex`. */
function skipStringLiteral(body: string, openIndex: number): number {
  const quote = body[openIndex]
  for (let index = openIndex + 1; index < body.length; index++) {
    if (body[index] === '\\') {
      index++
      continue
    }
    if (body[index] === quote) return index + 1
  }
  return body.length
}

/** The keyed members of an object literal, at its own top level only. */
function topLevelMembers(body: string): Array<{ key: string; start: number; end: number }> {
  const members: Array<{ key: string; start: number; end: number }> = []
  let depth = 0
  let index = 0
  let pending: { key: string; start: number } | null = null
  const flush = (end: number) => {
    if (pending) members.push({ ...pending, end })
    pending = null
  }

  while (index < body.length) {
    const char = body[index]
    if (char === '/' && body[index + 1] === '/') {
      const newline = body.indexOf('\n', index)
      index = newline === -1 ? body.length : newline + 1
      continue
    }
    if (char === '/' && body[index + 1] === '*') {
      const close = body.indexOf('*/', index)
      index = close === -1 ? body.length : close + 2
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      index = skipStringLiteral(body, index)
      continue
    }
    if (char === '{' || char === '(' || char === '[') {
      depth++
      index++
      continue
    }
    if (char === '}' || char === ')' || char === ']') {
      depth--
      if (depth === 0) flush(index)
      index++
      continue
    }
    if (depth === 1) {
      if (char === ',') {
        flush(index)
        index++
        continue
      }
      if (!pending && /[\s{,]/.test(body[index - 1] ?? '{')) {
        const key = /^([A-Za-z0-9_$]+)\s*:/.exec(body.slice(index))
        if (key) {
          pending = { key: key[1], start: index }
          index += key[0].length
          continue
        }
      }
    }
    index++
  }
  flush(body.length)
  return members
}

/**
 * The members of every exported `*Operations` registry, with the line span each
 * one occupies.
 *
 * This is the completeness half of the audit, and it asks a different question
 * from everything above: not *does this operation declare a capability*, but
 * *did this audit read this operation at all*. Assertion A can only speak about
 * operations the parsers found; a member minted by a form they do not follow
 * yields nothing, and nothing is indistinguishable from a clean file. Comparing
 * the registry a surface actually imports against what was parsed is what turns
 * that silence into a failure — an undercount reads exactly like success, which
 * is how five OAuth-connection operations shipped ungated.
 */
export function parseOperationRegistryMembers(source: string): OperationRegistryMember[] {
  const members: OperationRegistryMember[] = []
  OPERATION_REGISTRY.lastIndex = 0
  for (
    let match = OPERATION_REGISTRY.exec(source);
    match;
    match = OPERATION_REGISTRY.exec(source)
  ) {
    const openIndex = source.indexOf('{', match.index + match[0].length - 1)
    const body = balancedGroup(source, openIndex)
    for (const member of topLevelMembers(body)) {
      members.push({
        registry: match[1],
        member: member.key,
        startLine: lineAt(source, openIndex + member.start),
        endLine: lineAt(source, openIndex + member.end),
      })
    }
  }
  return members
}

/**
 * Capabilities declared enforced at a call site the funnel cannot reach.
 *
 * Deliberately a bare scan of the whole file, with no check that anything below
 * the annotation actually gates: an annotation left behind after its gate was
 * deleted still counts the capability as reachable, and assertion C stays
 * green. That is a real gap, and it is left open because every cheap shape that
 * would close it is wrong more often than it is right.
 *
 * The obvious shapes were measured against the 70-odd annotations in the tree:
 *
 *  - "the capability id appears in code in the same file" misses 7, among them
 *    `logs/application/list-public-logs.ts` and `get-public-log.ts`, which
 *    annotate `logs.cost` and `logs.trace_spans` over a call to
 *    `resolveLogFieldProjection` — the one place those two are read, named
 *    nowhere else because naming them twice is how one copy stops redacting.
 *  - "a capability sink is called within N lines below" misses 7 at any N,
 *    including `core/application/workspace-authorization.ts` (delegates to
 *    `requirePersonalApiKeysAllowed`), `invitations/workspace-invitations.ts`
 *    (`validateInvitationsAllowed`) and the three `integrations.manage` sites in
 *    `auth/oauth/credentials/route.ts` (`checkOAuthCredentialAccess`).
 *
 * Both fail on the same case, and it is the common one: the annotation sits
 * above a call to a DOMAIN helper that enforces the group somewhere else. A
 * lookahead would have to enumerate every such helper — which is the open-ended
 * set the annotation exists to describe in the first place, so the list would
 * go stale in exactly the direction that makes the audit lie.
 *
 * What does hold the line is assertion E's other half: an annotation cannot
 * invent enforcement for a key whose field says `ui-only` or `executor`, and a
 * capability whose gate is deleted along with its annotation is reported by
 * assertion C immediately. The gap is narrow — a gate deleted while its comment
 * is kept — and closing it wants a call-graph, not a regex.
 */
export function parseEnforcedAnnotations(source: string): string[] {
  return [...source.matchAll(new RegExp(`${ENFORCED_ANNOTATION}\\s*([a-z0-9_.]+)`, 'g'))].map(
    (match) => match[1]
  )
}

/** Whether an operation's `capability: 'none'` carries a reason. */
export function hasExemptAnnotation(source: string, line: number): boolean {
  const lines = source.split('\n')
  for (let back = line - 2; back >= 0 && back >= line - 2 - MAX_ANNOTATION_LOOKBACK; back--) {
    const candidate = lines[back]?.trim() ?? ''
    if (candidate === '') continue
    if (!candidate.startsWith('//') && !candidate.startsWith('*')) break
    if (candidate.includes(EXEMPT_ANNOTATION)) {
      return (
        candidate.slice(candidate.indexOf(EXEMPT_ANNOTATION) + EXEMPT_ANNOTATION.length).trim() !==
        ''
      )
    }
  }
  return false
}

function main(): void {
  const capabilitiesSource = readFileSync(join(ROOT, CAPABILITIES_FILE), 'utf8')
  const fieldsSource = readFileSync(join(ROOT, FIELDS_FILE), 'utf8')

  const capabilityIds = new Set(parseCapabilityIds(capabilitiesSource))
  const rules = parseCapabilityRules(capabilitiesSource)
  const enforcement = parseFieldEnforcement(fieldsSource)

  /**
   * This audit reads source text, so a rename it does not know about makes its
   * parsers return nothing — and every assertion below would then pass over an
   * empty set. An audit that goes quiet when it breaks is worse than no audit,
   * so refuse to report success on an obviously empty parse.
   */
  if (capabilityIds.size === 0 || rules.size === 0 || enforcement.size === 0) {
    console.error(
      'Permission-group enforcement audit could not read its own inputs:\n' +
        `  capabilities parsed: ${capabilityIds.size}, rules: ${rules.size}, config keys: ${enforcement.size}\n\n` +
        'One of CAPABILITY_IDS, CAPABILITY_RULES or PERMISSION_GROUP_FIELDS was renamed or\n' +
        'reshaped. Update the parsers in this script rather than leaving it passing vacuously.\n'
    )
    process.exit(1)
  }
  if (rules.size !== capabilityIds.size) {
    console.error(
      `Permission-group enforcement audit parsed ${capabilityIds.size} capabilities but ${rules.size} rules; the registry and its rules disagree.\n`
    )
    process.exit(1)
  }

  const sourceFiles = SCAN_ROOTS.flatMap((root) => walk(join(ROOT, root), []))

  const findings: Finding[] = []
  const usedCapabilities = new Set<string>()
  let declaredOperations = 0

  for (const file of sourceFiles) {
    const relativePath = relative(ROOT, file)
    const source = readFileSync(file, 'utf8')

    for (const capability of parseEnforcedAnnotations(source)) {
      usedCapabilities.add(capability)
      if (!capabilityIds.has(capability)) {
        findings.push({
          file: relativePath,
          message: `declares enforcement for unknown capability '${capability}'`,
        })
      }
    }

    if (!MINTS_AN_OPERATION.test(source) && !DECLARES_A_REGISTRY.test(source)) continue

    const { declarations, unreadable, overridable } = parseOperationCapabilities(source)

    for (const line of overridable) {
      findings.push({
        file: relativePath,
        line,
        message:
          "mints operations through a factory that takes a `Partial<…Operation>` override. The capability this audit reads is the one in the factory body or at the call site, and a partial spread over the result can replace it — including with 'none' — so what is declared here stops being what ships. Take the fields the factory varies as named parameters rather than an open override",
      })
    }

    for (const line of unreadable) {
      findings.push({
        file: relativePath,
        line,
        message:
          'operation-minting call this audit cannot read an id from — a const-reference id, an id taken as a bare argument by a builder that mints the operation itself, or a wrapper written as an arrow const rather than a `function`. Teach parseOperationCapabilities the form rather than letting the operation drop out of the count in silence',
      })
    }

    /**
     * A file that calls the builder and yields nothing means the parsers no
     * longer understand it. Per-file rather than a count floor: a floor rots on
     * every legitimate addition and invites bumping the number.
     */
    if (MINTS_AN_OPERATION.test(source) && declarations.length === 0 && unreadable.length === 0) {
      findings.push({
        file: relativePath,
        message:
          'mints an operation but this audit parsed none from it — the declaration form changed and every operation in this file is now unchecked',
      })
    }

    /**
     * Assertion F: every member of an exported registry was read.
     *
     * Everything above can only speak about what the parsers found. This asks
     * whether they found each thing a surface can actually import, which is the
     * only question whose answer distinguishes a clean file from one the
     * parsers walked straight past.
     */
    const readLines = [...declarations.map((declaration) => declaration.line), ...unreadable]
    for (const member of parseOperationRegistryMembers(source)) {
      if (readLines.some((line) => line >= member.startLine && line <= member.endLine)) continue
      findings.push({
        file: relativePath,
        line: member.startLine,
        message: `'${member.registry}.${member.member}' is exported as an operation but this audit read no operation from it — it is minted by a form the parsers do not follow, so nothing here checks what capability it declares. Name the builder \`define<Domain>Operation\` and pass it an object literal with a string \`id\` and \`capability\`, or teach parseOperationCapabilities the form; do not leave the member counted as reviewed while unread`,
      })
    }

    for (const declaration of declarations) {
      declaredOperations++
      if (declaration.capability === undefined) {
        findings.push({
          file: relativePath,
          line: declaration.line,
          message: `operation '${declaration.id}' declares a capability this audit cannot read — the field is required, so this is a declaration form the parsers do not follow; teach parseOperationCapabilities about it rather than leaving the operation unchecked`,
        })
        continue
      }
      if (declaration.capability === 'none') {
        if (!hasExemptAnnotation(source, declaration.line)) {
          findings.push({
            file: relativePath,
            line: declaration.line,
            message: `operation '${declaration.id}' declares capability 'none' without a reason — put '${EXEMPT_ANNOTATION} <why no permission group governs it>' in a comment directly above it`,
          })
        }
        continue
      }
      usedCapabilities.add(declaration.capability)
      if (!capabilityIds.has(declaration.capability)) {
        findings.push({
          file: relativePath,
          line: declaration.line,
          message: `operation '${declaration.id}' names unknown capability '${declaration.capability}'`,
        })
      }
    }
  }

  /** A capability nothing names is a key an admin can set to no effect. */
  for (const capability of capabilityIds) {
    if (usedCapabilities.has(capability)) continue
    findings.push({
      file: CAPABILITIES_FILE,
      message: `capability '${capability}' is declared but nothing enforces it — name it on an operation, or annotate its call site with '${ENFORCED_ANNOTATION} ${capability} — <reason>'`,
    })
  }

  const enforcedByRule = new Set([...rules.values()].flatMap((rule) => rule.configKeys))
  for (const [key, declared] of enforcement) {
    if (declared === 'capability' && !enforcedByRule.has(key)) {
      findings.push({
        file: FIELDS_FILE,
        message: `config key '${key}' claims capability enforcement but no rule reads it — give it a rule, or declare it 'executor' or 'ui-only'`,
      })
    }
    if (declared !== 'capability' && enforcedByRule.has(key)) {
      findings.push({
        file: FIELDS_FILE,
        message: `config key '${key}' is declared '${declared}' but a capability rule reads it — set enforcement to 'capability' so the key stops being documented as something weaker`,
      })
    }
  }

  if (findings.length > 0) {
    console.error('Permission-group enforcement audit failed:\n')
    for (const finding of findings) {
      const where = finding.line ? `${finding.file}:${finding.line}` : finding.file
      console.error(`  ${where}\n    ${finding.message}\n`)
    }
    console.error(
      'A permission-group key that reaches the admin editor without a server gate is a\n' +
        'restriction an organization believes it applied. Wire the gate, or declare the\n' +
        "key 'ui-only' so it is documented as a rendering hint rather than a control.\n"
    )
    process.exit(1)
  }

  console.log(
    `✓ permission-group enforcement: ${declaredOperations} operations declare a capability, ${capabilityIds.size} capabilities all enforced`
  )
}

if (import.meta.main) main()
