#!/usr/bin/env bun
/**
 * Enforces the two tool execution boundaries: external ToolConfig requests are materialized only
 * by request-transport.ts, while same-process work uses registered InternalToolConfig operations.
 * Tool definitions may not point back to Sim API routes or revive the retired request.internal
 * escape hatch.
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
const SIM_URLS_MODULE = '@/lib/core/utils/urls'
const SIM_ORIGIN_EXPORTS = new Set(['getBaseUrl', 'getInternalApiBaseUrl'])
const SIM_URL_BUILDER_EXPORTS = new Set(['ensureAbsoluteUrl'])
const EXECUTOR_HTTP_MODULE = '@/executor/utils/http'
const EXECUTOR_URL_BUILDER_EXPORTS = new Set(['buildAPIUrl'])
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])

interface Violation {
  file: string
  line: number
  expression: string
}

export interface ToolSelfHopViolation {
  file: string
  line: number
  toolId?: string
  reason: 'same-origin-tool-request' | 'legacy-internal-policy'
}

export interface ToolSelfHopAudit {
  violations: ToolSelfHopViolation[]
  detectedSelfHops: number
  legacyInternalPolicies: number
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

interface SelfHopResolver {
  bindings: ReadonlyMap<string, SyntaxNode>
  simOriginBindings: ReadonlySet<string>
  simUrlBuilderBindings: ReadonlySet<string>
  locals?: ReadonlyMap<string, SyntaxNode>
}

function resolveIdentifier(name: string, resolver: SelfHopResolver): SyntaxNode | undefined {
  return resolver.locals?.get(name) ?? resolver.bindings.get(name)
}

function isInternalPathExpression(
  expression: SyntaxNode,
  resolver: SelfHopResolver,
  seen = new Set<string>()
): boolean {
  const current = unwrapExpression(expression)
  const prefix = getStringPrefix(current)
  if (prefix?.startsWith('/api/')) return true

  if (current.type === 'Identifier' && typeof current.name === 'string') {
    if (seen.has(current.name)) return false
    const binding = resolveIdentifier(current.name, resolver)
    if (!binding) return false
    const nextSeen = new Set(seen)
    nextSeen.add(current.name)
    return isInternalPathExpression(binding, resolver, nextSeen)
  }

  if (current.type === 'ConditionalExpression') {
    return (
      (isSyntaxNode(current.consequent) &&
        isInternalPathExpression(current.consequent, resolver, new Set(seen))) ||
      (isSyntaxNode(current.alternate) &&
        isInternalPathExpression(current.alternate, resolver, new Set(seen)))
    )
  }
  if (current.type === 'LogicalExpression') {
    return (
      (isSyntaxNode(current.left) &&
        isInternalPathExpression(current.left, resolver, new Set(seen))) ||
      (isSyntaxNode(current.right) &&
        isInternalPathExpression(current.right, resolver, new Set(seen)))
    )
  }
  if (current.type === 'BinaryExpression' && current.operator === '+') {
    return isSyntaxNode(current.left)
      ? isInternalPathExpression(current.left, resolver, new Set(seen))
      : false
  }
  return false
}

function isSimOriginExpression(
  expression: SyntaxNode,
  resolver: SelfHopResolver,
  seen = new Set<string>()
): boolean {
  const current = unwrapExpression(expression)
  if (current.type === 'Identifier' && typeof current.name === 'string') {
    if (seen.has(current.name)) return false
    const binding = resolveIdentifier(current.name, resolver)
    if (!binding) return false
    const nextSeen = new Set(seen)
    nextSeen.add(current.name)
    return isSimOriginExpression(binding, resolver, nextSeen)
  }
  if (current.type === 'CallExpression' || current.type === 'OptionalCallExpression') {
    if (!isSyntaxNode(current.callee)) return false
    const callee = unwrapExpression(current.callee)
    if (
      callee.type === 'Identifier' &&
      typeof callee.name === 'string' &&
      resolver.simOriginBindings.has(callee.name)
    ) {
      return true
    }
  }
  if (current.type === 'ConditionalExpression') {
    return (
      (isSyntaxNode(current.consequent) &&
        isSimOriginExpression(current.consequent, resolver, new Set(seen))) ||
      (isSyntaxNode(current.alternate) &&
        isSimOriginExpression(current.alternate, resolver, new Set(seen)))
    )
  }
  if (current.type === 'LogicalExpression') {
    return (
      (isSyntaxNode(current.left) &&
        isSimOriginExpression(current.left, resolver, new Set(seen))) ||
      (isSyntaxNode(current.right) && isSimOriginExpression(current.right, resolver, new Set(seen)))
    )
  }
  return false
}

function isSameOriginConcatenation(expression: SyntaxNode, resolver: SelfHopResolver): boolean {
  const current = unwrapExpression(expression)
  if (
    current.type !== 'BinaryExpression' ||
    current.operator !== '+' ||
    !isSyntaxNode(current.left) ||
    !isSyntaxNode(current.right)
  ) {
    return false
  }
  return (
    isSimOriginExpression(current.left, resolver) &&
    isInternalPathExpression(current.right, resolver)
  )
}

function isInternalUrlConstruction(node: SyntaxNode, resolver: SelfHopResolver): boolean {
  const current = unwrapExpression(node)
  return (
    current.type === 'NewExpression' &&
    isSyntaxNode(current.callee) &&
    current.callee.type === 'Identifier' &&
    current.callee.name === 'URL' &&
    Array.isArray(current.arguments) &&
    current.arguments.length > 1 &&
    isSyntaxNode(current.arguments[0]) &&
    isSyntaxNode(current.arguments[1]) &&
    isInternalPathExpression(current.arguments[0], resolver) &&
    isSimOriginExpression(current.arguments[1], resolver)
  )
}

function collectImportedBindings(program: SyntaxNode): {
  simOriginBindings: Set<string>
  simUrlBuilderBindings: Set<string>
} {
  const simOriginBindings = new Set<string>()
  const simUrlBuilderBindings = new Set<string>()
  const statements = Array.isArray(program.body) ? program.body : []
  for (const statement of statements) {
    if (
      !isSyntaxNode(statement) ||
      statement.type !== 'ImportDeclaration' ||
      !isSyntaxNode(statement.source) ||
      statement.source.type !== 'StringLiteral' ||
      typeof statement.source.value !== 'string' ||
      !Array.isArray(statement.specifiers)
    ) {
      continue
    }
    const source = statement.source.value
    for (const specifier of statement.specifiers) {
      if (
        !isSyntaxNode(specifier) ||
        specifier.type !== 'ImportSpecifier' ||
        !isSyntaxNode(specifier.imported) ||
        !isSyntaxNode(specifier.local) ||
        specifier.local.type !== 'Identifier' ||
        typeof specifier.local.name !== 'string'
      ) {
        continue
      }
      const imported = specifier.imported
      const importedName =
        imported.type === 'Identifier' && typeof imported.name === 'string'
          ? imported.name
          : imported.type === 'StringLiteral' && typeof imported.value === 'string'
            ? imported.value
            : undefined
      if (!importedName) continue
      if (source === SIM_URLS_MODULE && SIM_ORIGIN_EXPORTS.has(importedName)) {
        simOriginBindings.add(specifier.local.name)
      }
      if (
        (source === SIM_URLS_MODULE && SIM_URL_BUILDER_EXPORTS.has(importedName)) ||
        (source === EXECUTOR_HTTP_MODULE && EXECUTOR_URL_BUILDER_EXPORTS.has(importedName))
      ) {
        simUrlBuilderBindings.add(specifier.local.name)
      }
    }
  }
  return { simOriginBindings, simUrlBuilderBindings }
}

function collectTopLevelBindings(program: SyntaxNode): Map<string, SyntaxNode> {
  const bindings = new Map<string, SyntaxNode>()
  const statements = Array.isArray(program.body) ? program.body : []
  for (const statement of statements) {
    if (!isSyntaxNode(statement)) continue
    if (
      statement.type === 'FunctionDeclaration' &&
      isSyntaxNode(statement.id) &&
      statement.id.type === 'Identifier' &&
      typeof statement.id.name === 'string'
    ) {
      bindings.set(statement.id.name, statement)
      continue
    }
    if (statement.type !== 'VariableDeclaration' || !Array.isArray(statement.declarations)) {
      continue
    }
    for (const declaration of statement.declarations) {
      if (
        isSyntaxNode(declaration) &&
        declaration.type === 'VariableDeclarator' &&
        isSyntaxNode(declaration.id) &&
        declaration.id.type === 'Identifier' &&
        typeof declaration.id.name === 'string' &&
        isSyntaxNode(declaration.init)
      ) {
        bindings.set(declaration.id.name, declaration.init)
      }
    }
  }
  return bindings
}

function expressionContainsInternalRoute(
  expression: SyntaxNode,
  resolver: SelfHopResolver,
  seen = new Set<string>()
): boolean {
  const current = unwrapExpression(expression)
  if (
    isInternalPathExpression(current, resolver) ||
    isInternalUrlConstruction(current, resolver) ||
    isSameOriginConcatenation(current, resolver)
  ) {
    return true
  }

  if (current.type === 'Identifier' && typeof current.name === 'string') {
    if (seen.has(current.name)) return false
    const binding = resolveIdentifier(current.name, resolver)
    if (!binding) return false
    const nextSeen = new Set(seen)
    nextSeen.add(current.name)
    return expressionContainsInternalRoute(binding, resolver, nextSeen)
  }

  if (
    current.type === 'CallExpression' ||
    current.type === 'OptionalCallExpression' ||
    current.type === 'NewExpression'
  ) {
    if (!isSyntaxNode(current.callee)) return false
    const callee = unwrapExpression(current.callee)
    if (callee.type === 'Identifier') {
      if (
        typeof callee.name === 'string' &&
        resolver.simUrlBuilderBindings.has(callee.name) &&
        Array.isArray(current.arguments) &&
        isSyntaxNode(current.arguments[0])
      ) {
        return isInternalPathExpression(current.arguments[0], resolver)
      }
      const binding =
        typeof callee.name === 'string' ? resolveIdentifier(callee.name, resolver) : undefined
      if (
        binding &&
        ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(
          unwrapExpression(binding).type
        )
      ) {
        if (typeof callee.name === 'string' && seen.has(callee.name)) return false
        const nextSeen = new Set(seen)
        if (typeof callee.name === 'string') nextSeen.add(callee.name)
        return functionContainsInternalRoute(
          binding,
          resolver,
          nextSeen,
          Array.isArray(current.arguments) ? current.arguments.filter(isSyntaxNode) : []
        )
      }
      return expressionContainsInternalRoute(callee, resolver, seen)
    }
    const access = getStaticMemberAccess(callee)
    return access ? expressionContainsInternalRoute(access.target, resolver, seen) : false
  }

  if (current.type === 'MemberExpression' || current.type === 'OptionalMemberExpression') {
    const access = getStaticMemberAccess(current)
    return access ? expressionContainsInternalRoute(access.target, resolver, seen) : false
  }

  if (
    ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(current.type)
  ) {
    return functionContainsInternalRoute(current, resolver, seen)
  }
  return false
}

function functionContainsInternalRoute(
  fn: SyntaxNode,
  resolver: SelfHopResolver,
  seen: ReadonlySet<string>,
  argumentsList: readonly SyntaxNode[] = []
): boolean {
  const current = unwrapExpression(fn)
  if (
    !['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(current.type)
  ) {
    return false
  }
  const locals = new Map(resolver.locals)
  const parameters = Array.isArray(current.params) ? current.params : []
  for (const [index, parameter] of parameters.entries()) {
    if (
      isSyntaxNode(parameter) &&
      parameter.type === 'Identifier' &&
      typeof parameter.name === 'string' &&
      argumentsList[index]
    ) {
      const argument = unwrapExpression(argumentsList[index])
      const resolvedArgument =
        argument.type === 'Identifier' && typeof argument.name === 'string'
          ? (resolveIdentifier(argument.name, resolver) ?? argument)
          : argument
      locals.set(parameter.name, resolvedArgument)
    }
  }
  const localResolver: SelfHopResolver = { ...resolver, locals }

  const collectLocals = (node: SyntaxNode) => {
    if (
      node !== current &&
      ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(node.type)
    ) {
      return
    }
    if (
      node.type === 'VariableDeclarator' &&
      isSyntaxNode(node.id) &&
      node.id.type === 'Identifier' &&
      typeof node.id.name === 'string' &&
      isSyntaxNode(node.init)
    ) {
      locals.set(node.id.name, node.init)
    }
    for (const child of getChildNodes(node)) collectLocals(child)
  }
  collectLocals(current)

  if (current.type === 'ArrowFunctionExpression' && isSyntaxNode(current.body)) {
    const body = unwrapExpression(current.body)
    if (
      body.type !== 'BlockStatement' &&
      expressionContainsInternalRoute(body, localResolver, new Set(seen))
    ) {
      return true
    }
  }

  let found = false
  const visit = (node: SyntaxNode) => {
    if (found) return
    if (
      node.type === 'ReturnStatement' &&
      isSyntaxNode(node.argument) &&
      expressionContainsInternalRoute(node.argument, localResolver, new Set(seen))
    ) {
      found = true
      return
    }
    if (isInternalUrlConstruction(node, localResolver)) {
      found = true
      return
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

/** Rejects tool definitions that route execution back through this Sim app. */
export function auditToolSelfHops(source: string, file = 'source.ts'): ToolSelfHopAudit {
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
  const violations: ToolSelfHopViolation[] = []
  let detectedSelfHops = 0
  let legacyInternalPolicies = 0
  const bindings = collectTopLevelBindings(syntaxTree.program)
  const importedBindings = collectImportedBindings(syntaxTree.program)
  const resolver: SelfHopResolver = { bindings, ...importedBindings }

  const visit = (node: SyntaxNode) => {
    if (node.type === 'ObjectExpression') {
      const requestProperty = getObjectProperty(node, 'request')
      if (requestProperty && isSyntaxNode(requestProperty.value)) {
        const request = unwrapExpression(requestProperty.value)
        const urlProperty = getObjectProperty(request, 'url')
        const internalProperty = getObjectProperty(request, 'internal')
        if (internalProperty) {
          legacyInternalPolicies += 1
          violations.push({
            file,
            line: internalProperty.loc?.start.line ?? requestProperty.loc?.start.line ?? 1,
            toolId: getToolId(node),
            reason: 'legacy-internal-policy',
          })
        }
        if (!urlProperty) {
          for (const child of getChildNodes(node)) visit(child)
          return
        }
        const url = urlProperty?.value
        const currentUrl = isSyntaxNode(url) ? unwrapExpression(url) : undefined
        const hasInternalRoute =
          currentUrl !== undefined && expressionContainsInternalRoute(currentUrl, resolver)

        if (hasInternalRoute) {
          detectedSelfHops += 1
          violations.push({
            file,
            line: urlProperty?.loc?.start.line ?? requestProperty.loc?.start.line ?? 1,
            toolId: getToolId(node),
            reason: 'same-origin-tool-request',
          })
        }
      }
    }
    for (const child of getChildNodes(node)) visit(child)
  }
  visit(syntaxTree.program)

  return { violations, detectedSelfHops, legacyInternalPolicies }
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
  const selfHopAudits = productionSources
    .filter((file) => file.startsWith(join(APP, 'tools')))
    .map((file) => auditToolSelfHops(readFileSync(file, 'utf8'), file))
  const selfHopViolations = selfHopAudits.flatMap((audit) => audit.violations)

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

  if (selfHopViolations.length > 0) {
    console.error('Tool definitions must not execute through same-origin Sim API routes:')
    for (const violation of selfHopViolations) {
      const description =
        violation.reason === 'same-origin-tool-request'
          ? 'replace the /api self-hop with InternalToolConfig.operation and a registered server handler'
          : 'request.internal is obsolete; use InternalToolConfig.operation for in-process work'
      console.error(
        `  ${relative(ROOT, violation.file)}:${violation.line}  ${violation.toolId ?? 'unknown tool'}: ${description}`
      )
    }
    process.exit(1)
  }

  console.log('✓ production tool requests are materialized only by the shared transport')
  const detectedSelfHops = selfHopAudits.reduce((total, audit) => total + audit.detectedSelfHops, 0)
  const legacyInternalPolicies = selfHopAudits.reduce(
    (total, audit) => total + audit.legacyInternalPolicies,
    0
  )
  console.log(
    `✓ no tool self-hops detected (${detectedSelfHops} same-origin requests, ${legacyInternalPolicies} legacy internal policies)`
  )
}

if (import.meta.main) main()
