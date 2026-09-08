#!/usr/bin/env bun
/**
 * Keeps personal API keys and OAuth access tokens admitted together in semantic
 * operation policies. Resolves local named arrays and spreads; an unreadable
 * value policy fails the audit instead of disappearing from its coverage.
 * Principal branching and declarations outside application/operations.ts still
 * require application authorization tests.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from '@typescript/typescript6'

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

interface PrincipalKindDeclaration {
  line: number
  kinds: string[]
  unresolved?: boolean
}

/** Reads value policies and literal tuple declarations, without matching comments or strings. */
export function parsePrincipalKindLiterals(source: string): PrincipalKindDeclaration[] {
  const file = ts.createSourceFile(OPERATIONS_FILE, source, ts.ScriptTarget.Latest, true)
  const constants = new Map<string, ts.Expression>()
  const declarations: PrincipalKindDeclaration[] = []

  function collect(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      constants.set(node.name.text, node.initializer)
    }
    ts.forEachChild(node, collect)
  }
  collect(file)

  function readKinds(node: ts.Node, seen = new Set<string>()): string[] | undefined {
    if (ts.isStringLiteral(node)) return [node.text]
    if (ts.isLiteralTypeNode(node)) return readKinds(node.literal, seen)
    if (ts.isTypeOperatorNode(node)) return readKinds(node.type, seen)
    if (
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isParenthesizedExpression(node)
    ) {
      return readKinds(node.expression, seen)
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Object' &&
      node.expression.name.text === 'freeze' &&
      node.arguments.length === 1
    ) {
      return readKinds(node.arguments[0], seen)
    }
    if (ts.isIdentifier(node)) {
      const initializer = constants.get(node.text)
      if (!initializer || seen.has(node.text)) return undefined
      return readKinds(initializer, new Set([...seen, node.text]))
    }
    if (ts.isSpreadElement(node)) return readKinds(node.expression, seen)
    if (ts.isArrayLiteralExpression(node) || ts.isTupleTypeNode(node)) {
      const kinds: string[] = []
      for (const element of node.elements) {
        const resolved = readKinds(element, seen)
        if (!resolved) return undefined
        kinds.push(...resolved)
      }
      return kinds
    }
    return undefined
  }

  function visit(node: ts.Node): void {
    if (
      (ts.isPropertyAssignment(node) || ts.isPropertySignature(node)) &&
      node.name.getText(file).replace(/['"]/g, '') === 'principalKinds'
    ) {
      const value = ts.isPropertyAssignment(node) ? node.initializer : node.type
      const kinds = value && readKinds(value)
      /** Generic interfaces are checked at their concrete value definitions. */
      if (kinds || ts.isPropertyAssignment(node)) {
        declarations.push({
          line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
          kinds: kinds ?? [],
          ...(kinds ? {} : { unresolved: true }),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return declarations
}

/** One operations file's findings, so the assertion is testable without a tree on disk. */
export function auditSource(file: string, source: string): { findings: Finding[]; pairs: number } {
  const findings: Finding[] = []
  let pairs = 0
  const [personal, oauth] = USER_CREDENTIAL_PRINCIPAL_KINDS

  for (const literal of parsePrincipalKindLiterals(source)) {
    if (literal.unresolved) {
      findings.push({
        file,
        line: literal.line,
        message:
          'Cannot resolve principalKinds; use a literal or a local constant so credential parity is audited.',
      })
      continue
    }
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
