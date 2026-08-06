#!/usr/bin/env bun
/**
 * Fails when production code reads an executable ToolConfig request member outside the canonical
 * transport. Tool definitions may declare request config, but only request-transport.ts may
 * materialize its URL, method, headers, or body. The direct-access check is intentionally
 * syntactic and zero-exception: ordinary nested request objects must first be bound to a local
 * before their wire members are read, keeping the reserved ToolConfig shape impossible to
 * reintroduce silently.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const APP = join(ROOT, 'apps/sim')
const CANONICAL_TRANSPORT = join(APP, 'tools/request-transport.ts')
const REQUEST_MEMBERS = new Set(['url', 'method', 'headers', 'body'])
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])

interface Violation {
  file: string
  line: number
  expression: string
}

function isProductionSource(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  return (
    SOURCE_EXTENSIONS.has(extname(path)) &&
    !normalized.endsWith('.d.ts') &&
    !/\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/.test(normalized) &&
    !normalized.includes('/__tests__/')
  )
}

function collectProductionSources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') {
      continue
    }
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collectProductionSources(path, found)
    else if (isProductionSource(path)) found.push(path)
  }
  return found
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function getStaticMemberAccess(
  expression: ts.Expression
): { target: ts.Expression; member: string } | undefined {
  const current = unwrapExpression(expression)
  if (ts.isPropertyAccessExpression(current)) {
    return { target: current.expression, member: current.name.text }
  }
  if (
    ts.isElementAccessExpression(current) &&
    current.argumentExpression &&
    (ts.isStringLiteral(current.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(current.argumentExpression))
  ) {
    return { target: current.expression, member: current.argumentExpression.text }
  }
  return undefined
}

function isLikelyToolIdentifier(expression: ts.Expression): boolean {
  const current = unwrapExpression(expression)
  return ts.isIdentifier(current) && (current.text === 'tool' || current.text.endsWith('Tool'))
}

export function findToolRequestBoundaryViolations(source: string, file = 'source.ts'): Violation[] {
  const extension = extname(file)
  const scriptKind =
    extension === '.tsx'
      ? ts.ScriptKind.TSX
      : extension === '.jsx'
        ? ts.ScriptKind.JSX
        : ['.js', '.mjs', '.cjs'].includes(extension)
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind)
  const requestAliases = new Set<string>()
  const violations: Violation[] = []
  const seen = new Set<number>()

  const report = (node: ts.Node) => {
    if (seen.has(node.getStart(sourceFile))) return
    seen.add(node.getStart(sourceFile))
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    violations.push({
      file,
      line: line + 1,
      expression: node.getText(sourceFile),
    })
  }

  const collectAliases = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const access = getStaticMemberAccess(node.initializer)
      if (access?.member === 'request' && isLikelyToolIdentifier(access.target)) {
        requestAliases.add(node.name.text)
      }
    }
    ts.forEachChild(node, collectAliases)
  }
  collectAliases(sourceFile)

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer
    ) {
      const sourceAccess = getStaticMemberAccess(node.initializer)
      const sourceIsToolRequest =
        sourceAccess?.member === 'request' && isLikelyToolIdentifier(sourceAccess.target)
      const source = unwrapExpression(node.initializer)
      const sourceIsToolRequestAlias = ts.isIdentifier(source) && requestAliases.has(source.text)
      if (sourceIsToolRequest || sourceIsToolRequestAlias) {
        for (const element of node.name.elements) {
          const property = element.propertyName ?? element.name
          if (ts.isIdentifier(property) && REQUEST_MEMBERS.has(property.text)) report(element)
        }
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const access = getStaticMemberAccess(node)
      if (access && REQUEST_MEMBERS.has(access.member)) {
        const target = unwrapExpression(access.target)
        const targetAccess = getStaticMemberAccess(target)
        if (
          targetAccess?.member === 'request' ||
          (ts.isIdentifier(target) && requestAliases.has(target.text))
        ) {
          report(node)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return violations
}

function main(): void {
  const violations = collectProductionSources(APP)
    .filter((file) => file !== CANONICAL_TRANSPORT)
    .flatMap((file) => findToolRequestBoundaryViolations(readFileSync(file, 'utf8'), file))

  if (violations.length > 0) {
    console.error('Direct ToolConfig request execution is forbidden outside the shared transport:')
    for (const violation of violations) {
      console.error(
        `  ${relative(ROOT, violation.file)}:${violation.line}  ${violation.expression}`
      )
    }
    console.error('\nPass the ToolConfig to prepareToolRequest from @/tools/request-transport.')
    process.exit(1)
  }

  console.log('✓ production tool requests are materialized only by the shared transport')
}

if (import.meta.main) main()
