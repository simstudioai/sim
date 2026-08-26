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

export interface RequestTrustViolation {
  file: string
  line: number
  toolId?: string
  reason:
    | 'missing-internal-policy'
    | 'internal-policy-without-internal-route'
    | 'mixed-route-requires-conditional-policy'
    | 'unsafe-internal-path-interpolation'
}

export interface RequestTrustAudit {
  violations: RequestTrustViolation[]
  dynamicInternalRoutes: number
  dynamicInternalPolicies: number
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

function getStaticPropertyName(property: SyntaxNode): string | undefined {
  if (!isSyntaxNode(property.key)) return undefined
  const key = property.key
  if (key.type === 'Identifier' && typeof key.name === 'string') return key.name
  if (key.type === 'StringLiteral' && typeof key.value === 'string') return key.value
  return undefined
}

function getObjectProperty(object: SyntaxNode, name: string): SyntaxNode | undefined {
  if (object.type !== 'ObjectExpression' || !Array.isArray(object.properties)) return undefined
  return object.properties.find(
    (property): property is SyntaxNode =>
      isSyntaxNode(property) &&
      property.type === 'ObjectProperty' &&
      getStaticPropertyName(property) === name
  )
}

function getStringPrefix(expression: SyntaxNode): string | undefined {
  const current = unwrapExpression(expression)
  if (current.type === 'StringLiteral' && typeof current.value === 'string') {
    return current.value
  }
  if (
    current.type === 'TemplateLiteral' &&
    Array.isArray(current.quasis) &&
    current.quasis.length > 0 &&
    isSyntaxNode(current.quasis[0])
  ) {
    const value = current.quasis[0].value
    if (typeof value === 'object' && value !== null) {
      if ('cooked' in value && typeof value.cooked === 'string') return value.cooked
      if ('raw' in value && typeof value.raw === 'string') return value.raw
    }
  }
  return undefined
}

function isInternalPathExpression(expression: SyntaxNode): boolean {
  const current = unwrapExpression(expression)
  const prefix = getStringPrefix(current)
  if (prefix?.startsWith('/api/')) return true

  if (current.type === 'ConditionalExpression') {
    return (
      (isSyntaxNode(current.consequent) && isInternalPathExpression(current.consequent)) ||
      (isSyntaxNode(current.alternate) && isInternalPathExpression(current.alternate))
    )
  }
  if (current.type === 'LogicalExpression') {
    return (
      (isSyntaxNode(current.left) && isInternalPathExpression(current.left)) ||
      (isSyntaxNode(current.right) && isInternalPathExpression(current.right))
    )
  }
  if (current.type === 'BinaryExpression' && current.operator === '+') {
    return (
      (isSyntaxNode(current.left) && isInternalPathExpression(current.left)) ||
      (isSyntaxNode(current.right) && isInternalPathExpression(current.right))
    )
  }
  return false
}

function isExternalUrlExpression(expression: SyntaxNode): boolean {
  const current = unwrapExpression(expression)
  const prefix = getStringPrefix(current)
  if (prefix && /^https?:\/\//.test(prefix)) return true

  if (current.type === 'ConditionalExpression') {
    return (
      (isSyntaxNode(current.consequent) && isExternalUrlExpression(current.consequent)) ||
      (isSyntaxNode(current.alternate) && isExternalUrlExpression(current.alternate))
    )
  }
  if (
    current.type === 'LogicalExpression' ||
    (current.type === 'BinaryExpression' && current.operator === '+')
  ) {
    return (
      (isSyntaxNode(current.left) && isExternalUrlExpression(current.left)) ||
      (isSyntaxNode(current.right) && isExternalUrlExpression(current.right))
    )
  }
  return false
}

function isInternalUrlConstruction(node: SyntaxNode): boolean {
  const current = unwrapExpression(node)
  if (
    current.type !== 'NewExpression' ||
    !isSyntaxNode(current.callee) ||
    current.callee.type !== 'Identifier' ||
    current.callee.name !== 'URL' ||
    !Array.isArray(current.arguments) ||
    current.arguments.length === 0 ||
    !isSyntaxNode(current.arguments[0])
  ) {
    return false
  }
  return getStringPrefix(current.arguments[0])?.startsWith('/api/') === true
}

function functionContainsInternalRoute(fn: SyntaxNode): boolean {
  const current = unwrapExpression(fn)
  if (
    !['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(current.type)
  ) {
    return false
  }
  if (current.type === 'ArrowFunctionExpression' && isSyntaxNode(current.body)) {
    const body = unwrapExpression(current.body)
    if (body.type !== 'BlockStatement' && isInternalPathExpression(body)) return true
  }

  let found = false
  const visit = (node: SyntaxNode) => {
    if (found) return
    if (
      node.type === 'ReturnStatement' &&
      isSyntaxNode(node.argument) &&
      isInternalPathExpression(node.argument)
    ) {
      found = true
      return
    }
    if (isInternalUrlConstruction(node)) {
      found = true
      return
    }
    for (const child of getChildNodes(node)) visit(child)
  }
  visit(current)
  return found
}

function functionContainsExternalRoute(fn: SyntaxNode): boolean {
  const current = unwrapExpression(fn)
  if (
    !['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(current.type)
  ) {
    return false
  }
  if (current.type === 'ArrowFunctionExpression' && isSyntaxNode(current.body)) {
    const body = unwrapExpression(current.body)
    if (body.type !== 'BlockStatement' && isExternalUrlExpression(body)) return true
  }

  let found = false
  const visit = (node: SyntaxNode) => {
    if (found) return
    if (
      node.type === 'ReturnStatement' &&
      isSyntaxNode(node.argument) &&
      isExternalUrlExpression(node.argument)
    ) {
      found = true
      return
    }
    for (const child of getChildNodes(node)) visit(child)
  }
  visit(current)
  return found
}

function collectBindingIdentifiers(pattern: SyntaxNode, bindings: Set<string>): void {
  const current = unwrapExpression(pattern)
  if (current.type === 'Identifier' && typeof current.name === 'string') {
    bindings.add(current.name)
    return
  }
  if (current.type === 'AssignmentPattern' && isSyntaxNode(current.left)) {
    collectBindingIdentifiers(current.left, bindings)
    return
  }
  if (current.type === 'RestElement' && isSyntaxNode(current.argument)) {
    collectBindingIdentifiers(current.argument, bindings)
    return
  }
  if (current.type === 'TSParameterProperty' && isSyntaxNode(current.parameter)) {
    collectBindingIdentifiers(current.parameter, bindings)
    return
  }
  if (current.type === 'ObjectPattern' && Array.isArray(current.properties)) {
    for (const property of current.properties) {
      if (!isSyntaxNode(property)) continue
      if (property.type === 'RestElement' && isSyntaxNode(property.argument)) {
        collectBindingIdentifiers(property.argument, bindings)
      } else if (property.type === 'ObjectProperty' && isSyntaxNode(property.value)) {
        collectBindingIdentifiers(property.value, bindings)
      }
    }
    return
  }
  if (current.type === 'ArrayPattern' && Array.isArray(current.elements)) {
    for (const element of current.elements) {
      if (isSyntaxNode(element)) collectBindingIdentifiers(element, bindings)
    }
  }
}

function getFunctionParameterBindings(fn: SyntaxNode): Set<string> {
  const bindings = new Set<string>()
  const current = unwrapExpression(fn)
  if (!Array.isArray(current.params)) return bindings
  for (const param of current.params) {
    if (isSyntaxNode(param)) collectBindingIdentifiers(param, bindings)
  }
  return bindings
}

function containsParameterReference(
  expression: SyntaxNode,
  parameterBindings: ReadonlySet<string>
): boolean {
  const current = unwrapExpression(expression)
  if (
    current.type === 'Identifier' &&
    typeof current.name === 'string' &&
    parameterBindings.has(current.name)
  ) {
    return true
  }
  return getChildNodes(current).some((child) =>
    containsParameterReference(child, parameterBindings)
  )
}

function isEncodedPathExpression(expression: SyntaxNode): boolean {
  const current = unwrapExpression(expression)
  return (
    current.type === 'CallExpression' &&
    isSyntaxNode(current.callee) &&
    current.callee.type === 'Identifier' &&
    current.callee.name === 'encodeURIComponent'
  )
}

function getConcatenationParts(expression: SyntaxNode): SyntaxNode[] {
  const current = unwrapExpression(expression)
  if (
    current.type !== 'BinaryExpression' ||
    current.operator !== '+' ||
    !isSyntaxNode(current.left) ||
    !isSyntaxNode(current.right)
  ) {
    return [current]
  }
  return [...getConcatenationParts(current.left), ...getConcatenationParts(current.right)]
}

function templateElementContainsQuery(element: unknown): boolean {
  if (!isSyntaxNode(element)) return false
  const value = element.value
  return (
    typeof value === 'object' &&
    value !== null &&
    (('cooked' in value && typeof value.cooked === 'string' && value.cooked.includes('?')) ||
      ('raw' in value && typeof value.raw === 'string' && value.raw.includes('?')))
  )
}

function inspectTemplatePathExpressions(
  template: SyntaxNode,
  parameterBindings: ReadonlySet<string>,
  initialQueryStarted = false
): { queryStarted: boolean; unsafe: boolean } {
  if (!Array.isArray(template.quasis) || !Array.isArray(template.expressions)) {
    return { queryStarted: initialQueryStarted, unsafe: false }
  }

  let queryStarted = initialQueryStarted
  for (let index = 0; index < template.expressions.length; index++) {
    if (templateElementContainsQuery(template.quasis[index])) queryStarted = true
    const expression = template.expressions[index]
    if (
      !queryStarted &&
      isSyntaxNode(expression) &&
      containsParameterReference(expression, parameterBindings) &&
      !isEncodedPathExpression(expression)
    ) {
      return { queryStarted, unsafe: true }
    }
  }
  if (templateElementContainsQuery(template.quasis[template.expressions.length])) {
    queryStarted = true
  }
  return { queryStarted, unsafe: false }
}

function functionContainsUnsafeInternalPathInterpolation(fn: SyntaxNode): boolean {
  const current = unwrapExpression(fn)
  const parameterBindings = getFunctionParameterBindings(current)
  let found = false

  const visit = (node: SyntaxNode) => {
    if (found) return
    if (
      node.type === 'BinaryExpression' &&
      node.operator === '+' &&
      isInternalPathExpression(node)
    ) {
      let queryStarted = false
      for (const part of getConcatenationParts(node)) {
        const currentPart = unwrapExpression(part)
        if (currentPart.type === 'TemplateLiteral') {
          const inspected = inspectTemplatePathExpressions(
            currentPart,
            parameterBindings,
            queryStarted
          )
          if (inspected.unsafe) {
            found = true
            return
          }
          queryStarted = inspected.queryStarted
          continue
        }
        const prefix = getStringPrefix(part)
        if (prefix?.includes('?')) queryStarted = true
        if (
          !queryStarted &&
          containsParameterReference(part, parameterBindings) &&
          !isEncodedPathExpression(part)
        ) {
          found = true
          return
        }
      }
    }
    if (
      node.type === 'TemplateLiteral' &&
      Array.isArray(node.quasis) &&
      Array.isArray(node.expressions) &&
      node.quasis.length > 0 &&
      isSyntaxNode(node.quasis[0]) &&
      getStringPrefix(node)?.startsWith('/api/')
    ) {
      if (inspectTemplatePathExpressions(node, parameterBindings).unsafe) {
        found = true
        return
      }
    }
    for (const child of getChildNodes(node)) visit(child)
  }

  visit(current)
  return found
}

function getToolId(object: SyntaxNode): string | undefined {
  const idProperty = getObjectProperty(object, 'id')
  if (!idProperty || !isSyntaxNode(idProperty.value)) return undefined
  const value = unwrapExpression(idProperty.value)
  return value.type === 'StringLiteral' && typeof value.value === 'string' ? value.value : undefined
}

/** Audits dynamic tool URL builders for an explicit, definition-owned internal-route policy. */
export function auditToolRequestTrust(source: string, file = 'source.ts'): RequestTrustAudit {
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
  const violations: RequestTrustViolation[] = []
  let dynamicInternalRoutes = 0
  let dynamicInternalPolicies = 0

  const visit = (node: SyntaxNode) => {
    if (node.type === 'ObjectExpression') {
      const requestProperty = getObjectProperty(node, 'request')
      if (requestProperty && isSyntaxNode(requestProperty.value)) {
        const request = unwrapExpression(requestProperty.value)
        const urlProperty = getObjectProperty(request, 'url')
        const internalProperty = getObjectProperty(request, 'internal')
        const url = urlProperty?.value
        const isDynamic =
          isSyntaxNode(url) &&
          ['ArrowFunctionExpression', 'FunctionExpression'].includes(unwrapExpression(url).type)
        if (isDynamic && isSyntaxNode(url)) {
          const hasInternalRoute = functionContainsInternalRoute(url)
          const hasExternalRoute = functionContainsExternalRoute(url)
          const hasInternalPolicy = internalProperty !== undefined
          const internalPolicyValue = internalProperty?.value
          const hasConditionalInternalPolicy =
            isSyntaxNode(internalPolicyValue) &&
            !(
              unwrapExpression(internalPolicyValue).type === 'BooleanLiteral' &&
              unwrapExpression(internalPolicyValue).value === true
            )
          const hasUnsafeInternalPathInterpolation =
            functionContainsUnsafeInternalPathInterpolation(url)
          if (hasInternalRoute) dynamicInternalRoutes += 1
          if (hasInternalPolicy) dynamicInternalPolicies += 1
          if (
            (hasInternalRoute && !hasInternalPolicy) ||
            (hasInternalPolicy &&
              hasExternalRoute &&
              !hasInternalRoute &&
              !hasConditionalInternalPolicy)
          ) {
            const location = (hasInternalPolicy ? internalProperty : urlProperty)?.loc?.start.line
            violations.push({
              file,
              line: location ?? requestProperty.loc?.start.line ?? 1,
              toolId: getToolId(node),
              reason: hasInternalRoute
                ? 'missing-internal-policy'
                : 'internal-policy-without-internal-route',
            })
          }
          if (
            hasInternalPolicy &&
            hasInternalRoute &&
            hasExternalRoute &&
            !hasConditionalInternalPolicy
          ) {
            violations.push({
              file,
              line: internalProperty?.loc?.start.line ?? requestProperty.loc?.start.line ?? 1,
              toolId: getToolId(node),
              reason: 'mixed-route-requires-conditional-policy',
            })
          }
          if (hasInternalRoute && hasUnsafeInternalPathInterpolation) {
            violations.push({
              file,
              line: urlProperty?.loc?.start.line ?? requestProperty.loc?.start.line ?? 1,
              toolId: getToolId(node),
              reason: 'unsafe-internal-path-interpolation',
            })
          }
        }
      }
    }
    for (const child of getChildNodes(node)) visit(child)
  }
  visit(syntaxTree.program)

  return { violations, dynamicInternalRoutes, dynamicInternalPolicies }
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
  const productionSources = collectProductionSources(APP)
  const violations = productionSources
    .filter((file) => file !== CANONICAL_TRANSPORT)
    .flatMap((file) => findToolRequestBoundaryViolations(readFileSync(file, 'utf8'), file))
  const requestTrustAudits = productionSources
    .filter((file) => file.startsWith(join(APP, 'tools')))
    .map((file) => auditToolRequestTrust(readFileSync(file, 'utf8'), file))
  const requestTrustViolations = requestTrustAudits.flatMap((audit) => audit.violations)

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

  if (requestTrustViolations.length > 0) {
    console.error('Dynamic tool routes have an invalid internal trust declaration:')
    for (const violation of requestTrustViolations) {
      const description =
        violation.reason === 'missing-internal-policy'
          ? 'dynamic /api route is missing request.internal'
          : violation.reason === 'internal-policy-without-internal-route'
            ? 'request.internal is declared but the URL builder has no /api route'
            : violation.reason === 'mixed-route-requires-conditional-policy'
              ? 'mixed internal/external URL builder requires a predicate request.internal policy'
              : 'dynamic /api path parameter must use encodeURIComponent'
      console.error(
        `  ${relative(ROOT, violation.file)}:${violation.line}  ${violation.toolId ?? 'unknown tool'}: ${description}`
      )
    }
    process.exit(1)
  }

  console.log('✓ production tool requests are materialized only by the shared transport')
  const dynamicInternalRoutes = requestTrustAudits.reduce(
    (total, audit) => total + audit.dynamicInternalRoutes,
    0
  )
  const dynamicInternalPolicies = requestTrustAudits.reduce(
    (total, audit) => total + audit.dynamicInternalPolicies,
    0
  )
  console.log(
    `✓ ${dynamicInternalRoutes} directly detectable dynamic internal routes declare trust (${dynamicInternalPolicies} explicit dynamic policies)`
  )
}

if (import.meta.main) main()
