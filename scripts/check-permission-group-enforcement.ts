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
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const SCAN_ROOTS = ['apps/sim/lib', 'apps/sim/app', 'apps/sim/ee', 'apps/sim/executor']
const CAPABILITIES_FILE = 'apps/sim/lib/permission-groups/capabilities.ts'
const FIELDS_FILE = 'apps/sim/lib/permission-groups/fields.ts'
const ENFORCED_ANNOTATION = 'permission-group-enforced:'
const EXEMPT_ANNOTATION = 'permission-group-exempt:'
const MAX_ANNOTATION_LOOKBACK = 3

interface Finding {
  file: string
  line?: number
  message: string
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

/**
 * Every `defineWorkspaceOperation` in a module and the capability it declares,
 * resolved through a same-file factory when a domain wraps the builder (the
 * table operations take only an id and a capability).
 */
export function parseOperationCapabilities(source: string): OperationDeclaration[] {
  const declarations: OperationDeclaration[] = []
  const lineAt = (index: number) => source.slice(0, index).split('\n').length

  /**
   * Domains that wrap the builder in a same-file factory declare the capability
   * one of two ways: fixed in the factory body, when every operation it makes
   * belongs to one capability, or taken as a second argument when they differ.
   * Both are legible at the call site, so both are read here.
   */
  const factoryCapabilities = new Map<string, string | 'positional'>()
  const factoryPattern = /(?:^|\n)\s*(?:export\s+)?function\s+([A-Za-z0-9_$]+)\s*[<(]/g
  for (let match = factoryPattern.exec(source); match; match = factoryPattern.exec(source)) {
    const bodyIndex = source.indexOf('{', match.index + match[0].length - 1)
    if (bodyIndex === -1) continue
    const body = balancedGroup(source, bodyIndex)
    if (!body.includes('defineWorkspaceOperation')) continue
    const fixed = /capability\s*:\s*'([a-z0-9_.]+)'/.exec(body)?.[1]
    if (fixed) factoryCapabilities.set(match[1], fixed)
    else if (/capability\s*[,:}]/.test(body)) factoryCapabilities.set(match[1], 'positional')
  }

  const directPattern = /defineWorkspaceOperation\s*\(/g
  for (let match = directPattern.exec(source); match; match = directPattern.exec(source)) {
    const call = balancedGroup(source, source.indexOf('(', match.index))
    const id = /id\s*:\s*'([^']+)'/.exec(call)?.[1]
    if (!id) continue
    declarations.push({
      id,
      line: lineAt(match.index),
      capability: /capability\s*:\s*'([a-z0-9_.]+)'/.exec(call)?.[1],
    })
  }

  for (const [factory, capability] of factoryCapabilities) {
    const callPattern =
      capability === 'positional'
        ? new RegExp(`\\b${factory}\\s*\\(\\s*'([^']+)'\\s*,\\s*'([a-z0-9_.]+)'`, 'g')
        : new RegExp(`\\b${factory}\\s*\\(\\s*'([^']+)'`, 'g')
    for (let match = callPattern.exec(source); match; match = callPattern.exec(source)) {
      declarations.push({
        id: match[1],
        line: lineAt(match.index),
        capability: capability === 'positional' ? match[2] : capability,
      })
    }
  }

  return declarations
}

/** Capabilities declared enforced at a call site the funnel cannot reach. */
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

    if (!source.includes('defineWorkspaceOperation')) continue

    for (const declaration of parseOperationCapabilities(source)) {
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
