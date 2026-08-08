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
import { parse } from '@babel/parser'

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

interface SyntaxNode extends Record<string, unknown> {
  type: string
  start?: number | null
  end?: number | null
  loc?: { start: { line: number } } | null
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

function isSyntaxNode(value: unknown): value is SyntaxNode {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  )
}

function getChildNodes(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = []
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isSyntaxNode(item)) children.push(item)
      }
    } else if (isSyntaxNode(value)) {
      children.push(value)
    }
  }
  return children
}

function unwrapExpression(expression: SyntaxNode): SyntaxNode {
  let current = expression
  while (
    [
      'ParenthesizedExpression',
      'TSAsExpression',
      'TSTypeAssertion',
      'TSNonNullExpression',
      'TSSatisfiesExpression',
      'TypeCastExpression',
    ].includes(current.type) &&
    isSyntaxNode(current.expression)
  ) {
    current = current.expression
  }
  return current
}

function getStaticMemberAccess(
  expression: SyntaxNode
): { target: SyntaxNode; member: string } | undefined {
  const current = unwrapExpression(expression)
  if (
    (current.type === 'MemberExpression' || current.type === 'OptionalMemberExpression') &&
    isSyntaxNode(current.object) &&
    isSyntaxNode(current.property)
  ) {
    const property = current.property
    if (
      current.computed === false &&
      property.type === 'Identifier' &&
      typeof property.name === 'string'
    ) {
      return { target: current.object, member: property.name }
    }
    if (
      current.computed === true &&
      property.type === 'StringLiteral' &&
      typeof property.value === 'string'
    ) {
      return { target: current.object, member: property.value }
    }
    if (
      current.computed === true &&
      property.type === 'TemplateLiteral' &&
      Array.isArray(property.expressions) &&
      property.expressions.length === 0 &&
      Array.isArray(property.quasis) &&
      property.quasis.length === 1 &&
      isSyntaxNode(property.quasis[0])
    ) {
      const value = property.quasis[0].value
      if (
        typeof value === 'object' &&
        value !== null &&
        'cooked' in value &&
        typeof value.cooked === 'string'
      ) {
        return { target: current.object, member: value.cooked }
      }
    }
  }
  return undefined
}

function isLikelyToolIdentifier(expression: SyntaxNode): boolean {
  const current = unwrapExpression(expression)
  return (
    current.type === 'Identifier' &&
    typeof current.name === 'string' &&
    (current.name === 'tool' || current.name.endsWith('Tool'))
  )
}

function findToolRequestBoundaryViolations(source: string, file = 'source.ts'): Violation[] {
  const extension = extname(file)
  const syntaxTree = parse(source, {
    sourceFilename: file,
    sourceType: 'unambiguous',
    errorRecovery: true,
    plugins: [
      ...(extension === '.jsx' || extension === '.tsx' ? (['jsx'] as const) : []),
      ...(!['.js', '.jsx', '.mjs', '.cjs'].includes(extension) ? (['typescript'] as const) : []),
    ],
  })
  const requestAliases = new Set<string>()
  const violations: Violation[] = []
  const seen = new Set<number>()

  const report = (node: SyntaxNode) => {
    if (typeof node.start !== 'number' || typeof node.end !== 'number' || !node.loc) return
    if (seen.has(node.start)) return
    seen.add(node.start)
    violations.push({
      file,
      line: node.loc.start.line,
      expression: source.slice(node.start, node.end),
    })
  }

  const collectAliases = (node: SyntaxNode) => {
    if (
      node.type === 'VariableDeclarator' &&
      isSyntaxNode(node.id) &&
      node.id.type === 'Identifier' &&
      typeof node.id.name === 'string' &&
      isSyntaxNode(node.init)
    ) {
      const access = getStaticMemberAccess(node.init)
      if (access?.member === 'request' && isLikelyToolIdentifier(access.target)) {
        requestAliases.add(node.id.name)
      }
    }
    for (const child of getChildNodes(node)) collectAliases(child)
  }
  collectAliases(syntaxTree.program)

  const visit = (node: SyntaxNode) => {
    if (
      node.type === 'VariableDeclarator' &&
      isSyntaxNode(node.id) &&
      node.id.type === 'ObjectPattern' &&
      isSyntaxNode(node.init)
    ) {
      const sourceAccess = getStaticMemberAccess(node.init)
      const sourceIsToolRequest =
        sourceAccess?.member === 'request' && isLikelyToolIdentifier(sourceAccess.target)
      const initializer = unwrapExpression(node.init)
      const sourceIsToolRequestAlias =
        initializer.type === 'Identifier' &&
        typeof initializer.name === 'string' &&
        requestAliases.has(initializer.name)
      if (sourceIsToolRequest || sourceIsToolRequestAlias) {
        const properties = Array.isArray(node.id.properties) ? node.id.properties : []
        for (const property of properties) {
          if (
            !isSyntaxNode(property) ||
            property.type !== 'ObjectProperty' ||
            !isSyntaxNode(property.key)
          ) {
            continue
          }
          const key = property.key
          const member =
            key.type === 'Identifier' && typeof key.name === 'string'
              ? key.name
              : key.type === 'StringLiteral' && typeof key.value === 'string'
                ? key.value
                : undefined
          if (member && REQUEST_MEMBERS.has(member)) report(property)
        }
      }
    }
    if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
      const access = getStaticMemberAccess(node)
      if (access && REQUEST_MEMBERS.has(access.member)) {
        const target = unwrapExpression(access.target)
        const targetAccess = getStaticMemberAccess(target)
        if (
          targetAccess?.member === 'request' ||
          (target.type === 'Identifier' &&
            typeof target.name === 'string' &&
            requestAliases.has(target.name))
        ) {
          report(node)
        }
      }
    }
    for (const child of getChildNodes(node)) visit(child)
  }
  visit(syntaxTree.program)

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
