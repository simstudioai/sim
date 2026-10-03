#!/usr/bin/env bun
/**
 * Fails when an operation an actorless run can reach demands a human subject.
 *
 * A workflow executes under a `Principal`, and several triggers have no person
 * behind them: a schedule, the public API, a webhook carrying no external subject.
 * Those runs still hold real authority — `workspace-authorization.ts` admits an
 * actorless executor delegation whose current workflow is a deployment — so they
 * are authorized callers with no `subjectUserId`. Any use case they can reach that
 * calls `requirePrincipalSubjectUserId` therefore throws, and because
 * `PrincipalSubjectUserRequiredError` is not an `OrchestrationError` it surfaces as
 * an opaque 500 rather than anything a workflow author can act on.
 *
 * That is not hypothetical: the Logs detail tools broke for every scheduled run
 * this way, and the failure reached production because nothing connected "this
 * operation admits `delegatedServices: ['executor']`" to "this use case requires a
 * person". This audit connects them.
 *
 * A subject is genuinely required often enough that the rule is an annotation, not
 * a ban. Write `// actorless-unsupported: <reason>` above the call to declare that
 * the operation has no meaning without a person — the annotation turns a silent
 * 500 into a documented gap that a reviewer can weigh.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const SCAN_ROOTS = ['apps/sim/lib', 'apps/sim/app']
const REQUIRE_CALL = 'requirePrincipalSubjectUserId('
const ANNOTATION = 'actorless-unsupported:'
const MAX_ANNOTATION_LOOKBACK = 3

/**
 * `apps/sim/lib/internal/**` is the in-process tool surface: every handler under it
 * mints an executor delegation, so its modules are executor-reachable whether or
 * not they bind a named operation.
 */
const EXECUTOR_SURFACE_PREFIX = 'apps/sim/lib/internal/'

export interface ActorlessFinding {
  file: string
  line: number
  reason: 'unannotated' | 'empty-reason'
  operations: string[]
}

/** How the file was shown to be reachable by an actorless run. */
type Reachability = 'internal-surface' | 'declared-operation' | 'unproven'

/** Text of the balanced `(...)` or `{...}` group that starts at `openIndex`. */
function balancedGroup(source: string, openIndex: number): string {
  const open = source[openIndex]
  const close = open === '(' ? ')' : '}'
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

function admitsExecutor(text: string): boolean {
  const match = /delegatedServices\s*:\s*\[([^\]]*)\]/.exec(text)
  return match ? /['"]executor['"]/.test(match[1]) : false
}

/**
 * Maps every `<namespace>.<key>` declared in an operations module to whether its
 * policy admits an executor delegation, resolving same-file policy constants that
 * are spread into the definition (e.g. `...LOG_READER_PRINCIPAL_POLICY`).
 */
export function parseOperationPolicies(source: string): Map<string, boolean> {
  const policies = new Map<string, boolean>()

  const spreadable = new Map<string, boolean>()
  const constPattern = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*\{/g
  for (let match = constPattern.exec(source); match; match = constPattern.exec(source)) {
    const braceIndex = source.indexOf('{', match.index + match[0].length - 1)
    spreadable.set(match[1], admitsExecutor(balancedGroup(source, braceIndex)))
  }

  /** Whether a `defineWorkspaceOperation({...})` call admits an executor delegation. */
  const definitionAdmitsExecutor = (definition: string): boolean => {
    if (admitsExecutor(definition)) return true
    return [...definition.matchAll(/\.\.\.([A-Za-z0-9_$]+)/g)].some(
      (spread) => spreadable.get(spread[1]) === true
    )
  }

  // Several domains declare their operations through same-file factories
  // (`toolReadOperation('tables.rows.query')`) rather than inline, so the policy has
  // to be resolved through the factory or those operations read as executor-free.
  const factories = new Map<string, boolean>()
  const factoryPattern = /(?:^|\n)\s*(?:export\s+)?function\s+([A-Za-z0-9_$]+)\s*[<(]/g
  for (let match = factoryPattern.exec(source); match; match = factoryPattern.exec(source)) {
    const bodyIndex = source.indexOf('{', match.index + match[0].length - 1)
    if (bodyIndex === -1) continue
    const body = balancedGroup(source, bodyIndex)
    const defineIndex = body.indexOf('defineWorkspaceOperation')
    if (defineIndex === -1) continue
    const parenIndex = body.indexOf('(', defineIndex)
    factories.set(match[1], definitionAdmitsExecutor(balancedGroup(body, parenIndex)))
  }

  const namespacePattern = /(?:^|\n)\s*export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*\{/g
  for (let match = namespacePattern.exec(source); match; match = namespacePattern.exec(source)) {
    const namespace = match[1]
    const braceIndex = source.indexOf('{', match.index + match[0].length - 1)
    const body = balancedGroup(source, braceIndex)

    const entryPattern = /([A-Za-z0-9_$]+)\s*:\s*([A-Za-z0-9_$]+)\s*\(/g
    for (let entry = entryPattern.exec(body); entry; entry = entryPattern.exec(body)) {
      const [, key, callee] = entry
      if (callee === 'defineWorkspaceOperation') {
        const parenIndex = body.indexOf('(', entry.index + entry[0].length - 1)
        policies.set(
          `${namespace}.${key}`,
          definitionAdmitsExecutor(balancedGroup(body, parenIndex))
        )
      } else if (factories.has(callee)) {
        policies.set(`${namespace}.${key}`, factories.get(callee) === true)
      }
    }
  }

  return policies
}

/** The declared operations a module references, whether to define or to bind them. */
export function referencedOperations(source: string, known: Set<string>): string[] {
  const referenced = new Set<string>()
  for (const match of source.matchAll(/([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)/g)) {
    const id = `${match[1]}.${match[2]}`
    if (known.has(id)) referenced.add(id)
  }
  return [...referenced].sort()
}

/**
 * Flags `requirePrincipalSubjectUserId` calls that are not declared actorless-unsupported.
 * Mirrors the placement rule the boundary annotations use: the annotation must sit in one
 * of the preceding comment lines, so extra context above it is fine.
 */
export function auditSubjectRequirements(source: string, operations: string[]): ActorlessFinding[] {
  const findings: ActorlessFinding[] = []
  const lines = source.split('\n')

  for (const [index, line] of lines.entries()) {
    if (!line.includes(REQUIRE_CALL)) continue

    let annotation: string | undefined
    for (let back = index - 1; back >= 0 && back >= index - MAX_ANNOTATION_LOOKBACK; back--) {
      const candidate = lines[back].trim()
      if (candidate === '') continue
      if (!candidate.startsWith('//') && !candidate.startsWith('*')) break
      const found = candidate.indexOf(ANNOTATION)
      if (found !== -1) {
        annotation = candidate.slice(found + ANNOTATION.length).trim()
        break
      }
    }

    if (annotation === undefined) {
      findings.push({ file: '', line: index + 1, reason: 'unannotated', operations })
    } else if (annotation === '') {
      findings.push({ file: '', line: index + 1, reason: 'empty-reason', operations })
    }
  }

  return findings
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

function main(): void {
  const sourceFiles = SCAN_ROOTS.flatMap((root) => walk(join(ROOT, root), []))

  const policies = new Map<string, boolean>()
  for (const file of sourceFiles) {
    if (!file.endsWith('/application/operations.ts')) continue
    for (const [id, executor] of parseOperationPolicies(readFileSync(file, 'utf8'))) {
      policies.set(id, executor)
    }
  }
  const known = new Set(policies.keys())
  const executorAdmitting = new Set([...policies].filter(([, yes]) => yes).map(([id]) => id))

  // Domains with at least one executor-admitting operation. A shared use-case
  // factory in such a domain names no operation of its own — it takes one as an
  // argument — so it cannot be proven executor-free and fails closed here.
  const executorDomains = new Set<string>()
  for (const file of sourceFiles) {
    if (!file.endsWith('/application/operations.ts')) continue
    const parsed = parseOperationPolicies(readFileSync(file, 'utf8'))
    if ([...parsed.values()].some(Boolean)) {
      executorDomains.add(relative(ROOT, dirname(dirname(file))))
    }
  }

  const findings: ActorlessFinding[] = []
  const reachabilityByFinding = new Map<ActorlessFinding, Reachability>()
  let auditedFiles = 0

  for (const file of sourceFiles) {
    const source = readFileSync(file, 'utf8')
    if (!source.includes(REQUIRE_CALL)) continue

    const relativePath = relative(ROOT, file)
    const operations = referencedOperations(source, known)
    const reachability: Reachability | undefined = relativePath.startsWith(EXECUTOR_SURFACE_PREFIX)
      ? 'internal-surface'
      : operations.some((id) => policies.get(id) === true)
        ? 'declared-operation'
        : operations.length === 0 &&
            [...executorDomains].some((domain) => relativePath.startsWith(`${domain}/`))
          ? 'unproven'
          : undefined
    if (!reachability) continue

    auditedFiles++
    for (const audited of auditSubjectRequirements(source, operations)) {
      const finding = { ...audited, file: relativePath }
      findings.push(finding)
      reachabilityByFinding.set(finding, reachability)
    }
  }

  if (findings.length > 0) {
    console.error(
      'Operations an actorless run can reach must not silently require a human subject:'
    )
    for (const finding of findings) {
      const reachability = reachabilityByFinding.get(finding)
      const via =
        reachability === 'internal-surface'
          ? 'in-process tool surface'
          : reachability === 'unproven'
            ? 'shared use case in a domain with executor-admitting operations'
            : `reachable via ${finding.operations.filter((id) => executorAdmitting.has(id)).join(', ')}`
      const problem =
        finding.reason === 'empty-reason'
          ? `${ANNOTATION} needs a reason`
          : `unannotated requirePrincipalSubjectUserId (${via})`
      console.error(`  ${finding.file}:${finding.line}  ${problem}`)
    }
    console.error(
      `\nA scheduled, public-API, or subject-less webhook run reaches these with no user, and` +
        `\n\`requirePrincipalSubjectUserId\` throws a 500 there rather than anything actionable.` +
        `\nEither resolve the user optionally (\`resolvePrincipalSubjectUserId\`) when it is only` +
        `\nattribution, or declare the gap with \`// ${ANNOTATION} <reason>\` above the call.`
    )
    process.exit(1)
  }

  console.log(
    `✓ no undeclared human-subject requirements on actorless-reachable operations ` +
      `(${executorAdmitting.size} executor-admitting operations, ${auditedFiles} files audited)`
  )
}

if (import.meta.main) main()
