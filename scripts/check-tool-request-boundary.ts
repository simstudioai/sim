#!/usr/bin/env bun
/**
 * Enforces the two tool execution boundaries: external ToolConfig requests are materialized only
 * by request-transport.ts, while same-process work uses registered InternalToolConfig operations.
 * Tool definitions may not point back to Sim API routes or revive the retired request.internal
 * escape hatch. Dynamic provider origins remain supported because the executor rejects their
 * resolved URL when it targets Sim; only the two generic user-directed HTTP tools may opt out.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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
const FUNCTION_NODE_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
  'ObjectMethod',
])
const URL_VALUE_WRAPPER_CALLS = new Set(['String', 'encodeURI', 'encodeURIComponent'])
const APPROVED_SAME_ORIGIN_TOOL_IDS = new Set(['http_request', 'webhook_request'])

interface Violation {
  file: string
  line: number
  expression: string
}

export interface ToolSelfHopViolation {
  file: string
  line: number
  toolId?: string
  reason:
    | 'same-origin-tool-request'
    | 'legacy-internal-policy'
    | 'retired-direct-execution'
    | 'unresolved-request-policy'
    | 'unapproved-same-origin-policy'
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
  if (property.computed === true) return getStaticString(key)
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

function getStaticString(expression: SyntaxNode): string | undefined {
  const current = unwrapExpression(expression)
  if (current.type === 'StringLiteral' && typeof current.value === 'string') return current.value
  if (
    current.type === 'TemplateLiteral' &&
    Array.isArray(current.expressions) &&
    current.expressions.length === 0 &&
    Array.isArray(current.quasis)
  ) {
    return current.quasis
      .filter(isSyntaxNode)
      .map((quasi) => {
        const value = quasi.value
        if (typeof value !== 'object' || value === null) return ''
        return 'cooked' in value && typeof value.cooked === 'string'
          ? value.cooked
          : 'raw' in value && typeof value.raw === 'string'
            ? value.raw
            : ''
      })
      .join('')
  }
  if (
    current.type === 'BinaryExpression' &&
    current.operator === '+' &&
    isSyntaxNode(current.left) &&
    isSyntaxNode(current.right)
  ) {
    const left = getStaticString(current.left)
    const right = getStaticString(current.right)
    return left !== undefined && right !== undefined ? left + right : undefined
  }
  return undefined
}

interface SelfHopResolver {
  bindings: ReadonlyMap<string, SyntaxNode>
  importedBindings: ReadonlyMap<string, ImportedBinding>
  simOriginBindings: ReadonlySet<string>
  simUrlBuilderBindings: ReadonlySet<string>
  file: string
  locals?: ReadonlyMap<string, SyntaxNode>
  scopedLocals?: ReadonlyMap<string, ScopedExpression>
}

interface ImportedBinding {
  importedName: string
  source: string
}

function resolveIdentifier(name: string, resolver: SelfHopResolver): SyntaxNode | undefined {
  return resolver.locals?.get(name) ?? resolver.bindings.get(name)
}

function resolveScopedIdentifier(
  name: string,
  resolver: SelfHopResolver
): ScopedExpression | undefined {
  const scopedLocal = resolver.scopedLocals?.get(name)
  if (scopedLocal) return scopedLocal
  const local = resolver.locals?.get(name)
  if (local) return { expression: local, resolver }
  const binding = resolver.bindings.get(name)
  if (binding) return { expression: binding, resolver }
  return loadImportedBinding(name, resolver)
}

function resolveScopedArgument(
  expression: SyntaxNode,
  resolver: SelfHopResolver
): ScopedExpression {
  const current = unwrapExpression(expression)
  if (current.type === 'Identifier' && typeof current.name === 'string') {
    return resolveScopedIdentifier(current.name, resolver) ?? { expression: current, resolver }
  }
  return { expression: current, resolver }
}

function collectFunctionLocalBindings(fn: SyntaxNode, locals: Map<string, SyntaxNode>): void {
  const visit = (node: SyntaxNode) => {
    if (node !== fn && FUNCTION_NODE_TYPES.has(node.type)) return
    if (
      node.type === 'VariableDeclarator' &&
      isSyntaxNode(node.id) &&
      node.id.type === 'Identifier' &&
      typeof node.id.name === 'string' &&
      isSyntaxNode(node.init)
    ) {
      locals.set(node.id.name, node.init)
    }
    for (const child of getChildNodes(node)) visit(child)
  }
  visit(fn)
}

function isInternalPathExpression(
  expression: SyntaxNode,
  resolver: SelfHopResolver,
  seen = new Set<string>(),
  allowRelative = false
): boolean {
  const current = unwrapExpression(expression)
  const staticValue = getStaticString(current)
  if (staticValue && isInternalApiPath(staticValue, allowRelative)) return true
  const prefix = getStringPrefix(current)
  if (prefix && isInternalApiPath(prefix, allowRelative)) return true

  if (current.type === 'Identifier' && typeof current.name === 'string') {
    const key = `${resolver.file}:path:${current.name}`
    if (seen.has(key)) return false
    const binding = resolveScopedIdentifier(current.name, resolver)
    if (!binding) return false
    const nextSeen = new Set(seen)
    nextSeen.add(key)
    return isInternalPathExpression(binding.expression, binding.resolver, nextSeen, allowRelative)
  }

  if (current.type === 'CallExpression' || current.type === 'OptionalCallExpression') {
    if (!isSyntaxNode(current.callee)) return false
    const callee = unwrapExpression(current.callee)
    if (callee.type === 'Identifier' && typeof callee.name === 'string') {
      const key = `${resolver.file}:path-call:${callee.name}`
      if (seen.has(key)) return false
      const binding = resolveScopedIdentifier(callee.name, resolver)
      if (binding && FUNCTION_NODE_TYPES.has(unwrapExpression(binding.expression).type)) {
        const nextSeen = new Set(seen)
        nextSeen.add(key)
        const argumentsList = Array.isArray(current.arguments)
          ? current.arguments
              .filter(isSyntaxNode)
              .map((argument) => resolveScopedArgument(argument, resolver))
          : []
        return functionReturnsInternalPath(
          binding.expression,
          binding.resolver,
          argumentsList,
          nextSeen,
          allowRelative
        )
      }
    }
  }

  if (current.type === 'ConditionalExpression') {
    return (
      (isSyntaxNode(current.consequent) &&
        isInternalPathExpression(current.consequent, resolver, new Set(seen), allowRelative)) ||
      (isSyntaxNode(current.alternate) &&
        isInternalPathExpression(current.alternate, resolver, new Set(seen), allowRelative))
    )
  }
  if (current.type === 'LogicalExpression') {
    return (
      (isSyntaxNode(current.left) &&
        isInternalPathExpression(current.left, resolver, new Set(seen), allowRelative)) ||
      (isSyntaxNode(current.right) &&
        isInternalPathExpression(current.right, resolver, new Set(seen), allowRelative))
    )
  }
  if (current.type === 'BinaryExpression' && current.operator === '+') {
    return isSyntaxNode(current.left)
      ? isInternalPathExpression(current.left, resolver, new Set(seen), allowRelative)
      : false
  }
  return false
}

function functionReturnsInternalPath(
  fn: SyntaxNode,
  resolver: SelfHopResolver,
  argumentsList: readonly ScopedExpression[],
  seen: ReadonlySet<string>,
  allowRelative: boolean
): boolean {
  const current = unwrapExpression(fn)
  if (!FUNCTION_NODE_TYPES.has(current.type)) return false
  const locals = new Map(resolver.locals)
  const scopedLocals = new Map(resolver.scopedLocals)
  const parameters = Array.isArray(current.params) ? current.params : []
  for (const [index, parameter] of parameters.entries()) {
    if (
      isSyntaxNode(parameter) &&
      parameter.type === 'Identifier' &&
      typeof parameter.name === 'string' &&
      argumentsList[index]
    ) {
      const argument = argumentsList[index]
      scopedLocals.set(parameter.name, argument)
      if (argument.resolver === resolver) locals.set(parameter.name, argument.expression)
    }
  }
  collectFunctionLocalBindings(current, locals)
  const localResolver = { ...resolver, locals, scopedLocals }
  if (current.type === 'ArrowFunctionExpression' && isSyntaxNode(current.body)) {
    const body = unwrapExpression(current.body)
    if (body.type !== 'BlockStatement') {
      return isInternalPathExpression(body, localResolver, new Set(seen), allowRelative)
    }
  }
  let found = false
  const visit = (node: SyntaxNode) => {
    if (found || (node !== current && FUNCTION_NODE_TYPES.has(node.type))) return
    if (
      node.type === 'ReturnStatement' &&
      isSyntaxNode(node.argument) &&
      isInternalPathExpression(node.argument, localResolver, new Set(seen), allowRelative)
    ) {
      found = true
      return
    }
    for (const child of getChildNodes(node)) visit(child)
  }
  visit(current)
  return found
}

function isInternalApiPath(value: string, allowRelative: boolean): boolean {
  if (value.startsWith('/api/')) return true
  if (!allowRelative) return false
  try {
    const base = new URL('https://sim-boundary.invalid/')
    const resolved = new URL(value, base)
    return resolved.origin === base.origin && resolved.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

function isOriginPreservingStaticSuffix(expression: SyntaxNode): boolean {
  const suffix = getStaticString(expression)
  return suffix !== undefined && (suffix === '' || /^[/?#]/.test(suffix))
}

function isSimOriginExpression(
  expression: SyntaxNode,
  resolver: SelfHopResolver,
  seen = new Set<string>()
): boolean {
  const current = unwrapExpression(expression)
  if (current.type === 'Identifier' && typeof current.name === 'string') {
    const key = `${resolver.file}:origin:${current.name}`
    if (seen.has(key)) return false
    const binding = resolveScopedIdentifier(current.name, resolver)
    if (!binding) return false
    const nextSeen = new Set(seen)
    nextSeen.add(key)
    return isSimOriginExpression(binding.expression, binding.resolver, nextSeen)
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
    if (callee.type === 'Identifier' && typeof callee.name === 'string') {
      const key = `${resolver.file}:origin-call:${callee.name}`
      if (seen.has(key)) return false
      const binding = resolveScopedIdentifier(callee.name, resolver)
      if (binding && FUNCTION_NODE_TYPES.has(unwrapExpression(binding.expression).type)) {
        const nextSeen = new Set(seen)
        nextSeen.add(key)
        const argumentsList = Array.isArray(current.arguments)
          ? current.arguments
              .filter(isSyntaxNode)
              .map((argument) => resolveScopedArgument(argument, resolver))
          : []
        return functionReturnsSimOrigin(
          binding.expression,
          binding.resolver,
          argumentsList,
          nextSeen
        )
      }
    }
  }
  if (
    current.type === 'BinaryExpression' &&
    current.operator === '+' &&
    isSyntaxNode(current.left) &&
    isSyntaxNode(current.right)
  ) {
    return (
      isSimOriginExpression(current.left, resolver, new Set(seen)) &&
      isOriginPreservingStaticSuffix(current.right)
    )
  }
  if (
    current.type === 'TemplateLiteral' &&
    Array.isArray(current.expressions) &&
    Array.isArray(current.quasis) &&
    current.expressions.length > 0 &&
    current.quasis.length === current.expressions.length + 1 &&
    current.expressions.every(isSyntaxNode) &&
    current.quasis.every(isSyntaxNode) &&
    getTemplateQuasiValue(current.quasis[0]) === '' &&
    isSimOriginExpression(current.expressions[0], resolver, new Set(seen))
  ) {
    const suffix = getTemplateQuasiValue(current.quasis[1])
    return (
      suffix !== undefined &&
      (suffix === '' ? current.expressions.length === 1 : /^[/?#]/.test(suffix))
    )
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

function functionReturnsSimOrigin(
  fn: SyntaxNode,
  resolver: SelfHopResolver,
  argumentsList: readonly ScopedExpression[],
  seen: ReadonlySet<string>
): boolean {
  const current = unwrapExpression(fn)
  if (!FUNCTION_NODE_TYPES.has(current.type)) return false
  const locals = new Map(resolver.locals)
  const scopedLocals = new Map(resolver.scopedLocals)
  const parameters = Array.isArray(current.params) ? current.params : []
  for (const [index, parameter] of parameters.entries()) {
    if (
      isSyntaxNode(parameter) &&
      parameter.type === 'Identifier' &&
      typeof parameter.name === 'string' &&
      argumentsList[index]
    ) {
      const argument = argumentsList[index]
      scopedLocals.set(parameter.name, argument)
      if (argument.resolver === resolver) locals.set(parameter.name, argument.expression)
    }
  }
  collectFunctionLocalBindings(current, locals)
  const localResolver = { ...resolver, locals, scopedLocals }
  if (current.type === 'ArrowFunctionExpression' && isSyntaxNode(current.body)) {
    const body = unwrapExpression(current.body)
    if (body.type !== 'BlockStatement') {
      return isSimOriginExpression(body, localResolver, new Set(seen))
    }
  }
  let found = false
  const visit = (node: SyntaxNode) => {
    if (found || (node !== current && FUNCTION_NODE_TYPES.has(node.type))) return
    if (
      node.type === 'ReturnStatement' &&
      isSyntaxNode(node.argument) &&
      isSimOriginExpression(node.argument, localResolver, new Set(seen))
    ) {
      found = true
      return
    }
    for (const child of getChildNodes(node)) visit(child)
  }
  visit(current)
  return found
}

function isSameOriginConcatenation(expression: SyntaxNode, resolver: SelfHopResolver): boolean {
  const current = unwrapExpression(expression)
  const parts: SyntaxNode[] = []
  const collect = (node: SyntaxNode) => {
    const value = unwrapExpression(node)
    if (
      value.type === 'BinaryExpression' &&
      value.operator === '+' &&
      isSyntaxNode(value.left) &&
      isSyntaxNode(value.right)
    ) {
      collect(value.left)
      collect(value.right)
      return
    }
    parts.push(value)
  }
  collect(current)
  if (parts.length < 2 || !isSimOriginExpression(parts[0], resolver)) return false
  let staticSuffix = ''
  for (const part of parts.slice(1)) {
    const value = getStaticString(part)
    if (value !== undefined) {
      staticSuffix += value
      if (staticSuffix.startsWith('/api/')) return true
      continue
    }
    if (isInternalPathExpression(part, resolver)) return true
    break
  }
  return false
}

function isKnownSimUrlBuilderCall(expression: SyntaxNode, resolver: SelfHopResolver): boolean {
  const current = unwrapExpression(expression)
  if (
    (current.type !== 'CallExpression' && current.type !== 'OptionalCallExpression') ||
    !isSyntaxNode(current.callee) ||
    !Array.isArray(current.arguments) ||
    !isSyntaxNode(current.arguments[0])
  ) {
    return false
  }
  const callee = unwrapExpression(current.callee)
  return (
    callee.type === 'Identifier' &&
    typeof callee.name === 'string' &&
    resolver.simUrlBuilderBindings.has(callee.name) &&
    isInternalPathExpression(current.arguments[0], resolver)
  )
}

function getTemplateQuasiValue(quasi: SyntaxNode): string | undefined {
  const value = quasi.value
  if (typeof value !== 'object' || value === null) return undefined
  if ('cooked' in value && typeof value.cooked === 'string') return value.cooked
  return 'raw' in value && typeof value.raw === 'string' ? value.raw : undefined
}

function isSameOriginTemplate(expression: SyntaxNode, resolver: SelfHopResolver): boolean {
  const current = unwrapExpression(expression)
  if (
    current.type !== 'TemplateLiteral' ||
    !Array.isArray(current.expressions) ||
    !Array.isArray(current.quasis) ||
    current.expressions.length === 0 ||
    current.quasis.length !== current.expressions.length + 1 ||
    !current.expressions.every(isSyntaxNode) ||
    !current.quasis.every(isSyntaxNode)
  ) {
    return false
  }
  const leadingQuasi = getTemplateQuasiValue(current.quasis[0])
  if (leadingQuasi !== '') return false
  const origin = current.expressions[0]
  if (!isSimOriginExpression(origin, resolver)) return false
  const pathQuasi = getTemplateQuasiValue(current.quasis[1])
  if (pathQuasi?.startsWith('/api/')) return true
  return (
    pathQuasi === '' &&
    current.expressions.length > 1 &&
    isInternalPathExpression(current.expressions[1], resolver)
  )
}

function isInternalUrlConstruction(node: SyntaxNode, resolver: SelfHopResolver): boolean {
  const current = unwrapExpression(node)
  if (
    current.type !== 'NewExpression' ||
    !isSyntaxNode(current.callee) ||
    current.callee.type !== 'Identifier' ||
    current.callee.name !== 'URL' ||
    !Array.isArray(current.arguments) ||
    !isSyntaxNode(current.arguments[0])
  ) {
    return false
  }
  if (current.arguments.length === 1) {
    return (
      isSameOriginConcatenation(current.arguments[0], resolver) ||
      isSameOriginTemplate(current.arguments[0], resolver) ||
      isKnownSimUrlBuilderCall(current.arguments[0], resolver)
    )
  }
  return (
    isSyntaxNode(current.arguments[1]) &&
    isInternalPathExpression(current.arguments[0], resolver, new Set(), true) &&
    isSimOriginExpression(current.arguments[1], resolver)
  )
}

function hasExplicitExternalUrlPrefix(
  expression: SyntaxNode,
  resolver: SelfHopResolver,
  seen = new Set<string>()
): boolean {
  const current = unwrapExpression(expression)
  const staticValue = getStaticString(current)
  if (staticValue !== undefined) return /^https?:\/\//.test(staticValue)
  const prefix = getStringPrefix(current)
  if (prefix !== undefined && /^https?:\/\//.test(prefix)) return true
  if (current.type === 'Identifier' && typeof current.name === 'string') {
    const key = `${resolver.file}:external-origin:${current.name}`
    if (seen.has(key)) return false
    const binding = resolveScopedIdentifier(current.name, resolver)
    if (!binding) return false
    const nextSeen = new Set(seen)
    nextSeen.add(key)
    return hasExplicitExternalUrlPrefix(binding.expression, binding.resolver, nextSeen)
  }
  if (
    current.type === 'BinaryExpression' &&
    current.operator === '+' &&
    isSyntaxNode(current.left)
  ) {
    return hasExplicitExternalUrlPrefix(current.left, resolver, new Set(seen))
  }
  if (current.type === 'ConditionalExpression') {
    return (
      isSyntaxNode(current.consequent) &&
      isSyntaxNode(current.alternate) &&
      hasExplicitExternalUrlPrefix(current.consequent, resolver, new Set(seen)) &&
      hasExplicitExternalUrlPrefix(current.alternate, resolver, new Set(seen))
    )
  }
  if (current.type === 'LogicalExpression') {
    return (
      isSyntaxNode(current.left) &&
      isSyntaxNode(current.right) &&
      hasExplicitExternalUrlPrefix(current.left, resolver, new Set(seen)) &&
      hasExplicitExternalUrlPrefix(current.right, resolver, new Set(seen))
    )
  }
  if (
    current.type === 'TemplateLiteral' &&
    Array.isArray(current.expressions) &&
    Array.isArray(current.quasis) &&
    current.expressions.length > 0 &&
    current.quasis.length === current.expressions.length + 1 &&
    current.expressions.every(isSyntaxNode) &&
    current.quasis.every(isSyntaxNode) &&
    getTemplateQuasiValue(current.quasis[0]) === '' &&
    hasExplicitExternalUrlPrefix(current.expressions[0], resolver, new Set(seen))
  ) {
    const suffix = getTemplateQuasiValue(current.quasis[1])
    return (
      suffix !== undefined &&
      (suffix === '' ? current.expressions.length === 1 : /^[/?#]/.test(suffix))
    )
  }
  return false
}

function expressionContainsUnresolvedUrlHelper(
  expression: SyntaxNode,
  resolver: SelfHopResolver,
  seen = new Set<string>(),
  unresolvedIdentifierIsUnsafe = false
): boolean {
  const current = unwrapExpression(expression)
  if (hasExplicitExternalUrlPrefix(current, resolver)) return false

  if (current.type === 'Identifier' && typeof current.name === 'string') {
    const key = `${resolver.file}:unresolved-url:${current.name}`
    if (seen.has(key)) return false
    const binding = resolveScopedIdentifier(current.name, resolver)
    if (!binding) return unresolvedIdentifierIsUnsafe
    const nextSeen = new Set(seen)
    nextSeen.add(key)
    return expressionContainsUnresolvedUrlHelper(
      binding.expression,
      binding.resolver,
      nextSeen,
      unresolvedIdentifierIsUnsafe
    )
  }

  if (current.type === 'ConditionalExpression') {
    return (
      (isSyntaxNode(current.consequent) &&
        expressionContainsUnresolvedUrlHelper(
          current.consequent,
          resolver,
          new Set(seen),
          unresolvedIdentifierIsUnsafe
        )) ||
      (isSyntaxNode(current.alternate) &&
        expressionContainsUnresolvedUrlHelper(
          current.alternate,
          resolver,
          new Set(seen),
          unresolvedIdentifierIsUnsafe
        ))
    )
  }
  if (current.type === 'LogicalExpression') {
    return (
      (isSyntaxNode(current.left) &&
        expressionContainsUnresolvedUrlHelper(
          current.left,
          resolver,
          new Set(seen),
          unresolvedIdentifierIsUnsafe
        )) ||
      (isSyntaxNode(current.right) &&
        expressionContainsUnresolvedUrlHelper(
          current.right,
          resolver,
          new Set(seen),
          unresolvedIdentifierIsUnsafe
        ))
    )
  }
  if (
    current.type === 'BinaryExpression' &&
    current.operator === '+' &&
    isSyntaxNode(current.left)
  ) {
    if (isSimOriginExpression(current.left, resolver) && isSyntaxNode(current.right)) {
      return expressionContainsUnresolvedUrlHelper(current.right, resolver, new Set(seen), true)
    }
    if (unresolvedIdentifierIsUnsafe && isSyntaxNode(current.right)) {
      return (
        expressionContainsUnresolvedUrlHelper(current.left, resolver, new Set(seen), true) ||
        expressionContainsUnresolvedUrlHelper(current.right, resolver, new Set(seen), true)
      )
    }
    return expressionContainsUnresolvedUrlHelper(
      current.left,
      resolver,
      new Set(seen),
      unresolvedIdentifierIsUnsafe
    )
  }
  if (
    current.type === 'TemplateLiteral' &&
    Array.isArray(current.expressions) &&
    Array.isArray(current.quasis) &&
    current.expressions.every(isSyntaxNode) &&
    current.quasis.every(isSyntaxNode) &&
    current.expressions.length > 0 &&
    current.quasis.length === current.expressions.length + 1
  ) {
    const leading = getTemplateQuasiValue(current.quasis[0])
    if (leading !== '') {
      return (
        unresolvedIdentifierIsUnsafe &&
        current.expressions.some((part) =>
          expressionContainsUnresolvedUrlHelper(part, resolver, new Set(seen), true)
        )
      )
    }
    const origin = current.expressions[0]
    if (isSimOriginExpression(origin, resolver)) {
      const following = getTemplateQuasiValue(current.quasis[1])
      return (
        following === '' &&
        current.expressions.length > 1 &&
        expressionContainsUnresolvedUrlHelper(current.expressions[1], resolver, new Set(seen), true)
      )
    }
    return expressionContainsUnresolvedUrlHelper(
      origin,
      resolver,
      new Set(seen),
      unresolvedIdentifierIsUnsafe
    )
  }

  if (current.type === 'CallExpression' || current.type === 'OptionalCallExpression') {
    if (!isSyntaxNode(current.callee)) return true
    const callee = unwrapExpression(current.callee)
    if (callee.type === 'Identifier' && typeof callee.name === 'string') {
      if (
        resolver.simOriginBindings.has(callee.name) ||
        resolver.simUrlBuilderBindings.has(callee.name)
      ) {
        return false
      }
      if (URL_VALUE_WRAPPER_CALLS.has(callee.name)) {
        if (unresolvedIdentifierIsUnsafe && callee.name === 'encodeURIComponent') return false
        const firstArgument = Array.isArray(current.arguments)
          ? current.arguments.find(isSyntaxNode)
          : undefined
        return firstArgument
          ? expressionContainsUnresolvedUrlHelper(
              firstArgument,
              resolver,
              new Set(seen),
              unresolvedIdentifierIsUnsafe
            )
          : false
      }
      const key = `${resolver.file}:unresolved-url-call:${callee.name}`
      if (seen.has(key)) return false
      const binding = resolveScopedIdentifier(callee.name, resolver)
      if (!binding || !FUNCTION_NODE_TYPES.has(unwrapExpression(binding.expression).type)) {
        return true
      }
      const nextSeen = new Set(seen)
      nextSeen.add(key)
      const argumentsList = Array.isArray(current.arguments)
        ? current.arguments
            .filter(isSyntaxNode)
            .map((argument) => resolveScopedArgument(argument, resolver))
        : []
      return functionContainsUnresolvedUrlHelper(
        binding.expression,
        binding.resolver,
        nextSeen,
        argumentsList,
        unresolvedIdentifierIsUnsafe
      )
    }
    const access = getStaticMemberAccess(callee)
    if (!access) return true
    return expressionContainsUnresolvedUrlHelper(
      access.target,
      resolver,
      new Set(seen),
      unresolvedIdentifierIsUnsafe
    )
  }

  if (current.type === 'NewExpression') {
    if (
      isSyntaxNode(current.callee) &&
      current.callee.type === 'Identifier' &&
      current.callee.name === 'URL' &&
      Array.isArray(current.arguments)
    ) {
      if (
        current.arguments.length > 1 &&
        isSyntaxNode(current.arguments[1]) &&
        hasExplicitExternalUrlPrefix(current.arguments[1], resolver)
      ) {
        return false
      }
      const path = current.arguments.find(isSyntaxNode)
      const base = current.arguments.length > 1 ? current.arguments[1] : undefined
      if (isSyntaxNode(base)) {
        return isSimOriginExpression(base, resolver)
          ? Boolean(
              path && expressionContainsUnresolvedUrlHelper(path, resolver, new Set(seen), true)
            )
          : expressionContainsUnresolvedUrlHelper(
              base,
              resolver,
              new Set(seen),
              unresolvedIdentifierIsUnsafe
            )
      }
      return path
        ? expressionContainsUnresolvedUrlHelper(
            path,
            resolver,
            new Set(seen),
            unresolvedIdentifierIsUnsafe
          )
        : false
    }
    return true
  }

  if (current.type === 'MemberExpression' || current.type === 'OptionalMemberExpression') {
    const access = getStaticMemberAccess(current)
    return access
      ? expressionContainsUnresolvedUrlHelper(
          access.target,
          resolver,
          new Set(seen),
          unresolvedIdentifierIsUnsafe
        )
      : unresolvedIdentifierIsUnsafe
  }
  if (FUNCTION_NODE_TYPES.has(current.type)) {
    return functionContainsUnresolvedUrlHelper(
      current,
      resolver,
      seen,
      [],
      unresolvedIdentifierIsUnsafe
    )
  }
  return false
}

function functionContainsUnresolvedUrlHelper(
  fn: SyntaxNode,
  resolver: SelfHopResolver,
  seen: ReadonlySet<string>,
  argumentsList: readonly ScopedExpression[] = [],
  unresolvedIdentifierIsUnsafe = false
): boolean {
  const current = unwrapExpression(fn)
  if (!FUNCTION_NODE_TYPES.has(current.type)) return true
  const locals = new Map(resolver.locals)
  const scopedLocals = new Map(resolver.scopedLocals)
  const parameters = Array.isArray(current.params) ? current.params : []
  for (const [index, parameter] of parameters.entries()) {
    if (
      isSyntaxNode(parameter) &&
      parameter.type === 'Identifier' &&
      typeof parameter.name === 'string' &&
      argumentsList[index]
    ) {
      const argument = argumentsList[index]
      scopedLocals.set(parameter.name, argument)
      if (argument.resolver === resolver) locals.set(parameter.name, argument.expression)
    }
  }
  collectFunctionLocalBindings(current, locals)
  const localResolver = { ...resolver, locals, scopedLocals }
  if (current.type === 'ArrowFunctionExpression' && isSyntaxNode(current.body)) {
    const body = unwrapExpression(current.body)
    if (body.type !== 'BlockStatement') {
      return expressionContainsUnresolvedUrlHelper(
        body,
        localResolver,
        new Set(seen),
        unresolvedIdentifierIsUnsafe
      )
    }
  }
  let unresolved = false
  const visit = (node: SyntaxNode) => {
    if (unresolved || (node !== current && FUNCTION_NODE_TYPES.has(node.type))) return
    if (
      node.type === 'ReturnStatement' &&
      isSyntaxNode(node.argument) &&
      expressionContainsUnresolvedUrlHelper(
        node.argument,
        localResolver,
        new Set(seen),
        unresolvedIdentifierIsUnsafe
      )
    ) {
      unresolved = true
      return
    }
    for (const child of getChildNodes(node)) visit(child)
  }
  visit(current)
  return unresolved
}

function collectImportedBindings(program: SyntaxNode): {
  importedBindings: Map<string, ImportedBinding>
  simOriginBindings: Set<string>
  simUrlBuilderBindings: Set<string>
} {
  const importedBindings = new Map<string, ImportedBinding>()
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
      importedBindings.set(specifier.local.name, { importedName, source })
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
  return { importedBindings, simOriginBindings, simUrlBuilderBindings }
}

function collectTopLevelBindings(program: SyntaxNode): Map<string, SyntaxNode> {
  const bindings = new Map<string, SyntaxNode>()
  const statements = Array.isArray(program.body) ? program.body : []
  for (const statement of statements) {
    if (!isSyntaxNode(statement)) continue
    const declaration =
      statement.type === 'ExportNamedDeclaration' && isSyntaxNode(statement.declaration)
        ? statement.declaration
        : statement
    if (
      declaration.type === 'FunctionDeclaration' &&
      isSyntaxNode(declaration.id) &&
      declaration.id.type === 'Identifier' &&
      typeof declaration.id.name === 'string'
    ) {
      bindings.set(declaration.id.name, declaration)
      continue
    }
    if (declaration.type !== 'VariableDeclaration' || !Array.isArray(declaration.declarations)) {
      continue
    }
    for (const variable of declaration.declarations) {
      if (
        isSyntaxNode(variable) &&
        variable.type === 'VariableDeclarator' &&
        isSyntaxNode(variable.id) &&
        variable.id.type === 'Identifier' &&
        typeof variable.id.name === 'string' &&
        isSyntaxNode(variable.init)
      ) {
        bindings.set(variable.id.name, variable.init)
      }
    }
  }
  return bindings
}

const MODULE_RESOLVER_CACHE = new Map<string, SelfHopResolver>()

function parseProgram(source: string, file: string): SyntaxNode {
  const extension = extname(file)
  return parse(source, {
    sourceFilename: file,
    sourceType: 'unambiguous',
    errorRecovery: true,
    plugins: [
      ...(extension === '.jsx' || extension === '.tsx' ? (['jsx'] as const) : []),
      ...(!['.js', '.jsx', '.mjs', '.cjs'].includes(extension) ? (['typescript'] as const) : []),
    ],
  }).program
}

function createSelfHopResolver(program: SyntaxNode, file: string): SelfHopResolver {
  return {
    bindings: collectTopLevelBindings(program),
    ...collectImportedBindings(program),
    file,
  }
}

function resolveImportFile(importerFile: string, source: string): string | undefined {
  if (!source.startsWith('@/') && !source.startsWith('./') && !source.startsWith('../')) {
    return undefined
  }
  const base = source.startsWith('@/')
    ? join(APP, source.slice(2))
    : resolve(dirname(importerFile), source)
  const candidates = [
    base,
    ...[...SOURCE_EXTENSIONS].map((extension) => `${base}${extension}`),
    ...[...SOURCE_EXTENSIONS].map((extension) => join(base, `index${extension}`)),
  ]
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
}

function loadImportedBinding(
  name: string,
  resolver: SelfHopResolver
): { expression: SyntaxNode; resolver: SelfHopResolver } | undefined {
  const imported = resolver.importedBindings.get(name)
  if (!imported) return undefined
  const importedFile = resolveImportFile(resolver.file, imported.source)
  if (!importedFile) return undefined
  let importedResolver = MODULE_RESOLVER_CACHE.get(importedFile)
  if (!importedResolver) {
    importedResolver = createSelfHopResolver(
      parseProgram(readFileSync(importedFile, 'utf8'), importedFile),
      importedFile
    )
    MODULE_RESOLVER_CACHE.set(importedFile, importedResolver)
  }
  const expression = importedResolver.bindings.get(imported.importedName)
  return expression ? { expression, resolver: importedResolver } : undefined
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
    isSameOriginConcatenation(current, resolver) ||
    isSameOriginTemplate(current, resolver)
  ) {
    return true
  }

  if (current.type === 'Identifier' && typeof current.name === 'string') {
    const key = `${resolver.file}:route:${current.name}`
    if (seen.has(key)) return false
    const binding = resolveScopedIdentifier(current.name, resolver)
    if (!binding) return false
    const nextSeen = new Set(seen)
    nextSeen.add(key)
    return expressionContainsInternalRoute(binding.expression, binding.resolver, nextSeen)
  }

  if (
    current.type === 'CallExpression' ||
    current.type === 'OptionalCallExpression' ||
    current.type === 'NewExpression'
  ) {
    if (!isSyntaxNode(current.callee)) return false
    const callee = unwrapExpression(current.callee)
    if (callee.type === 'Identifier') {
      if (isKnownSimUrlBuilderCall(current, resolver)) return true
      const binding =
        typeof callee.name === 'string' ? resolveScopedIdentifier(callee.name, resolver) : undefined
      if (binding && FUNCTION_NODE_TYPES.has(unwrapExpression(binding.expression).type)) {
        const key = `${resolver.file}:route-call:${callee.name}`
        if (seen.has(key)) return false
        const nextSeen = new Set(seen)
        nextSeen.add(key)
        const argumentsList = Array.isArray(current.arguments)
          ? current.arguments
              .filter(isSyntaxNode)
              .map((argument) => resolveScopedArgument(argument, resolver))
          : []
        return functionContainsInternalRoute(
          binding.expression,
          binding.resolver,
          nextSeen,
          argumentsList
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

  if (FUNCTION_NODE_TYPES.has(current.type)) {
    return functionContainsInternalRoute(current, resolver, seen)
  }
  return false
}

function functionContainsInternalRoute(
  fn: SyntaxNode,
  resolver: SelfHopResolver,
  seen: ReadonlySet<string>,
  argumentsList: readonly ScopedExpression[] = []
): boolean {
  const current = unwrapExpression(fn)
  if (!FUNCTION_NODE_TYPES.has(current.type)) {
    return false
  }
  const locals = new Map(resolver.locals)
  const scopedLocals = new Map(resolver.scopedLocals)
  const parameters = Array.isArray(current.params) ? current.params : []
  for (const [index, parameter] of parameters.entries()) {
    if (
      isSyntaxNode(parameter) &&
      parameter.type === 'Identifier' &&
      typeof parameter.name === 'string' &&
      argumentsList[index]
    ) {
      const argument = argumentsList[index]
      scopedLocals.set(parameter.name, argument)
      if (argument.resolver === resolver) locals.set(parameter.name, argument.expression)
    }
  }
  const localResolver: SelfHopResolver = { ...resolver, locals, scopedLocals }

  collectFunctionLocalBindings(current, locals)

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
    if (found || (node !== current && FUNCTION_NODE_TYPES.has(node.type))) return
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

function resolveStaticStringExpression(
  expression: SyntaxNode,
  resolver: SelfHopResolver,
  seen = new Set<string>()
): string | undefined {
  const value = unwrapExpression(expression)
  const staticValue = getStaticString(value)
  if (staticValue !== undefined) return staticValue
  if (value.type !== 'Identifier' || typeof value.name !== 'string') return undefined
  const key = `${resolver.file}:static-string:${value.name}`
  if (seen.has(key)) return undefined
  const binding = resolveScopedIdentifier(value.name, resolver)
  if (!binding) return undefined
  const nextSeen = new Set(seen)
  nextSeen.add(key)
  return resolveStaticStringExpression(binding.expression, binding.resolver, nextSeen)
}

function getToolId(object: SyntaxNode, resolver: SelfHopResolver): string | undefined {
  const idProperty = getObjectProperty(object, 'id')
  if (!idProperty || !isSyntaxNode(idProperty.value)) return undefined
  return resolveStaticStringExpression(idProperty.value, resolver)
}

interface ScopedExpression {
  expression: SyntaxNode
  resolver: SelfHopResolver
}

interface ResolvedRequestObject extends ScopedExpression {
  locals: ReadonlyMap<string, ScopedExpression>
}

interface ResolvedObjectProperty {
  property: SyntaxNode
  request: ResolvedRequestObject
}

interface RequestObjectResolution {
  requests: ResolvedRequestObject[]
  complete: boolean
}

interface ObjectPropertyResolution {
  properties: Array<ResolvedObjectProperty | undefined>
  complete: boolean
}

function combineRequestResolutions(
  resolutions: readonly RequestObjectResolution[]
): RequestObjectResolution {
  return {
    requests: resolutions.flatMap((resolution) => resolution.requests),
    complete: resolutions.every((resolution) => resolution.complete),
  }
}

function resolveScopedBinding(
  name: string,
  resolver: SelfHopResolver,
  locals: ReadonlyMap<string, ScopedExpression>
): ScopedExpression | undefined {
  const local = locals.get(name)
  if (local) return local
  const binding = resolver.bindings.get(name)
  if (binding) return { expression: binding, resolver }
  return loadImportedBinding(name, resolver)
}

function collectFunctionLocals(
  fn: SyntaxNode,
  resolver: SelfHopResolver,
  argumentsList: readonly ScopedExpression[]
): Map<string, ScopedExpression> {
  const locals = new Map<string, ScopedExpression>()
  const parameters = Array.isArray(fn.params) ? fn.params : []
  for (const [index, parameter] of parameters.entries()) {
    if (
      isSyntaxNode(parameter) &&
      parameter.type === 'Identifier' &&
      typeof parameter.name === 'string' &&
      argumentsList[index]
    ) {
      locals.set(parameter.name, argumentsList[index])
    }
  }
  const collect = (node: SyntaxNode) => {
    if (node !== fn && FUNCTION_NODE_TYPES.has(node.type)) {
      return
    }
    if (
      node.type === 'VariableDeclarator' &&
      isSyntaxNode(node.id) &&
      node.id.type === 'Identifier' &&
      typeof node.id.name === 'string' &&
      isSyntaxNode(node.init)
    ) {
      locals.set(node.id.name, { expression: node.init, resolver })
    }
    for (const child of getChildNodes(node)) collect(child)
  }
  collect(fn)
  return locals
}

function resolveRequestObjects(
  scoped: ScopedExpression,
  locals: ReadonlyMap<string, ScopedExpression> = new Map(),
  seen = new Set<string>()
): RequestObjectResolution {
  const current = unwrapExpression(scoped.expression)
  if (current.type === 'ObjectExpression') {
    return {
      requests: [{ expression: current, resolver: scoped.resolver, locals }],
      complete: true,
    }
  }

  if (current.type === 'Identifier' && typeof current.name === 'string') {
    const key = `${scoped.resolver.file}:binding:${current.name}`
    if (seen.has(key)) return { requests: [], complete: false }
    const binding = resolveScopedBinding(current.name, scoped.resolver, locals)
    if (!binding) return { requests: [], complete: false }
    const nextSeen = new Set(seen)
    nextSeen.add(key)
    return resolveRequestObjects(binding, locals, nextSeen)
  }

  if (current.type === 'MemberExpression' || current.type === 'OptionalMemberExpression') {
    const access = getStaticMemberAccess(current)
    if (!access) return { requests: [], complete: false }
    const targets = resolveRequestObjects(
      { expression: access.target, resolver: scoped.resolver },
      locals,
      new Set(seen)
    )
    const resolutions: RequestObjectResolution[] = []
    let complete = targets.complete
    for (const target of targets.requests) {
      const properties = getResolvedObjectProperties(target, access.member, new Set(seen))
      complete &&= properties.complete
      for (const resolved of properties.properties) {
        if (!resolved || !isSyntaxNode(resolved.property.value)) {
          complete = false
          continue
        }
        resolutions.push(
          resolveRequestObjects(
            { expression: resolved.property.value, resolver: resolved.request.resolver },
            resolved.request.locals,
            new Set(seen)
          )
        )
      }
    }
    const combined = combineRequestResolutions(resolutions)
    return { requests: combined.requests, complete: complete && combined.complete }
  }

  if (current.type === 'ConditionalExpression') {
    return combineRequestResolutions(
      [current.consequent, current.alternate]
        .filter(isSyntaxNode)
        .map((branch) =>
          resolveRequestObjects(
            { expression: branch, resolver: scoped.resolver },
            locals,
            new Set(seen)
          )
        )
    )
  }

  if (current.type === 'LogicalExpression') {
    return combineRequestResolutions(
      [current.left, current.right]
        .filter(isSyntaxNode)
        .map((branch) =>
          resolveRequestObjects(
            { expression: branch, resolver: scoped.resolver },
            locals,
            new Set(seen)
          )
        )
    )
  }

  if (current.type !== 'CallExpression' && current.type !== 'OptionalCallExpression') {
    return { requests: [], complete: false }
  }
  if (!isSyntaxNode(current.callee)) return { requests: [], complete: false }
  const callee = unwrapExpression(current.callee)
  if (callee.type !== 'Identifier' || typeof callee.name !== 'string') {
    return { requests: [], complete: false }
  }
  const key = `${scoped.resolver.file}:call:${callee.name}`
  if (seen.has(key)) return { requests: [], complete: false }
  const binding = resolveScopedBinding(callee.name, scoped.resolver, locals)
  if (!binding) return { requests: [], complete: false }
  const fn = unwrapExpression(binding.expression)
  if (!FUNCTION_NODE_TYPES.has(fn.type)) {
    return { requests: [], complete: false }
  }
  const argumentsList = Array.isArray(current.arguments)
    ? current.arguments
        .filter(isSyntaxNode)
        .map((argument) => resolveScopedArgument(argument, scoped.resolver))
    : []
  const functionLocals = collectFunctionLocals(fn, binding.resolver, argumentsList)
  const nextSeen = new Set(seen)
  nextSeen.add(key)
  if (fn.type === 'ArrowFunctionExpression' && isSyntaxNode(fn.body)) {
    const body = unwrapExpression(fn.body)
    if (body.type !== 'BlockStatement') {
      return resolveRequestObjects(
        { expression: body, resolver: binding.resolver },
        functionLocals,
        nextSeen
      )
    }
  }
  const results: ResolvedRequestObject[] = []
  let complete = true
  let returnCount = 0
  const visit = (node: SyntaxNode) => {
    if (node !== fn && FUNCTION_NODE_TYPES.has(node.type)) return
    if (node.type === 'ReturnStatement' && isSyntaxNode(node.argument)) {
      returnCount += 1
      const resolution = resolveRequestObjects(
        { expression: node.argument, resolver: binding.resolver },
        functionLocals,
        new Set(nextSeen)
      )
      results.push(...resolution.requests)
      complete &&= resolution.complete
      return
    }
    for (const child of getChildNodes(node)) visit(child)
  }
  visit(fn)
  return { requests: results, complete: complete && returnCount > 0 }
}

function requestObjectResolver(request: ResolvedRequestObject): SelfHopResolver {
  const locals = new Map<string, SyntaxNode>()
  for (const [name, value] of request.locals) {
    const current = unwrapExpression(value.expression)
    if (
      value.resolver === request.resolver ||
      (current.type === 'StringLiteral' && typeof current.value === 'string')
    ) {
      locals.set(name, current)
    }
  }
  return { ...request.resolver, locals, scopedLocals: request.locals }
}

function getResolvedObjectProperties(
  request: ResolvedRequestObject,
  name: string,
  seen = new Set<string>(),
  endIndex?: number
): ObjectPropertyResolution {
  if (!Array.isArray(request.expression.properties)) {
    return { properties: [], complete: false }
  }
  const properties = request.expression.properties.filter(isSyntaxNode)
  const lastIndex = endIndex ?? properties.length - 1
  for (let index = lastIndex; index >= 0; index -= 1) {
    const property = properties[index]
    if (property.type === 'ObjectProperty' || property.type === 'ObjectMethod') {
      const propertyName = getStaticPropertyName(property)
      if (propertyName === name) {
        return { properties: [{ property, request }], complete: true }
      }
      if (property.computed === true && propertyName === undefined) {
        const earlier = getResolvedObjectProperties(request, name, seen, index - 1)
        return { properties: earlier.properties, complete: false }
      }
    }
    if (property.type !== 'SpreadElement' || !isSyntaxNode(property.argument)) continue
    const key = `${request.resolver.file}:spread:${property.start ?? index}:${name}`
    if (seen.has(key)) return { properties: [], complete: false }
    const nextSeen = new Set(seen)
    nextSeen.add(key)
    const spreadResolution = resolveRequestObjects(
      { expression: property.argument, resolver: request.resolver },
      request.locals,
      nextSeen
    )
    const resolved: Array<ResolvedObjectProperty | undefined> = []
    let complete = spreadResolution.complete
    const fallback = () => getResolvedObjectProperties(request, name, nextSeen, index - 1)
    if (spreadResolution.requests.length === 0) {
      const earlier = fallback()
      return { properties: earlier.properties, complete: false }
    }
    for (const spreadRequest of spreadResolution.requests) {
      const spreadProperties = getResolvedObjectProperties(spreadRequest, name, nextSeen)
      complete &&= spreadProperties.complete
      for (const spreadProperty of spreadProperties.properties) {
        if (spreadProperty) {
          resolved.push(spreadProperty)
          continue
        }
        const earlier = fallback()
        resolved.push(...earlier.properties)
        complete &&= earlier.complete
      }
    }
    return { properties: resolved, complete }
  }
  return { properties: [undefined], complete: true }
}

/** Rejects tool definitions that route execution back through this Sim app. */
export function auditToolSelfHops(source: string, file = 'source.ts'): ToolSelfHopAudit {
  const program = parseProgram(source, file)
  const violations: ToolSelfHopViolation[] = []
  let detectedSelfHops = 0
  let legacyInternalPolicies = 0
  const resolver = createSelfHopResolver(program, file)
  const retiredDirectExecutionLocations = new Set<number>()

  const visit = (node: SyntaxNode) => {
    if (
      ['ObjectProperty', 'ObjectMethod', 'TSPropertySignature', 'TSMethodSignature'].includes(
        node.type
      ) &&
      getStaticPropertyName(node) === 'directExecution'
    ) {
      const location = node.start ?? node.loc?.start.line ?? -1
      if (!retiredDirectExecutionLocations.has(location)) {
        retiredDirectExecutionLocations.add(location)
        violations.push({
          file,
          line: node.loc?.start.line ?? 1,
          reason: 'retired-direct-execution',
        })
      }
    }
    if (node.type === 'ObjectExpression') {
      const idProperty = getObjectProperty(node, 'id')
      const toolId = idProperty ? getToolId(node, resolver) : undefined
      const directRequestProperty = getObjectProperty(node, 'request')
      if (idProperty && (toolId !== undefined || directRequestProperty)) {
        const toolObject: ResolvedRequestObject = {
          expression: node,
          resolver,
          locals: new Map(),
        }
        const requestProperties = getResolvedObjectProperties(toolObject, 'request')
        const concreteRequestProperties = requestProperties.properties.filter(
          (property): property is ResolvedObjectProperty => property !== undefined
        )
        let unresolvedReported = false
        const reportUnresolved = (line: number) => {
          if (unresolvedReported) return
          unresolvedReported = true
          violations.push({
            file,
            line,
            toolId,
            reason: 'unresolved-request-policy',
          })
        }
        if (!requestProperties.complete) {
          reportUnresolved(node.loc?.start.line ?? 1)
        }
        for (const {
          property: requestProperty,
          request: requestOwner,
        } of concreteRequestProperties) {
          if (!isSyntaxNode(requestProperty.value)) {
            reportUnresolved(requestProperty.loc?.start.line ?? 1)
            continue
          }
          const requests = resolveRequestObjects(
            { expression: requestProperty.value, resolver: requestOwner.resolver },
            requestOwner.locals
          )
          if (!requests.complete || requests.requests.length === 0) {
            reportUnresolved(requestProperty.loc?.start.line ?? 1)
          }
          for (const request of requests.requests) {
            const urlProperties = getResolvedObjectProperties(request, 'url')
            const internalProperties = getResolvedObjectProperties(request, 'internal')
            const allowSameOriginProperties = getResolvedObjectProperties(
              request,
              'allowSameOrigin'
            )
            let hasLegacyInternalPolicy = false
            if (
              !urlProperties.complete ||
              !internalProperties.complete ||
              !allowSameOriginProperties.complete
            ) {
              reportUnresolved(requestProperty.loc?.start.line ?? 1)
            }
            for (const resolvedInternal of internalProperties.properties) {
              if (!resolvedInternal) continue
              const internalProperty = resolvedInternal.property
              hasLegacyInternalPolicy = true
              legacyInternalPolicies += 1
              violations.push({
                file,
                line: internalProperty.loc?.start.line ?? requestProperty.loc?.start.line ?? 1,
                toolId,
                reason: 'legacy-internal-policy',
              })
            }
            for (const resolvedPolicy of allowSameOriginProperties.properties) {
              if (!resolvedPolicy) continue
              const policyProperty = resolvedPolicy.property
              const policyValue =
                policyProperty.type === 'ObjectProperty' && isSyntaxNode(policyProperty.value)
                  ? unwrapExpression(policyProperty.value)
                  : undefined
              if (!policyValue || policyValue.type !== 'BooleanLiteral') {
                reportUnresolved(
                  policyProperty.loc?.start.line ?? requestProperty.loc?.start.line ?? 1
                )
                continue
              }
              if (policyValue.value === true && !APPROVED_SAME_ORIGIN_TOOL_IDS.has(toolId)) {
                violations.push({
                  file,
                  line: policyProperty.loc?.start.line ?? requestProperty.loc?.start.line ?? 1,
                  toolId,
                  reason: 'unapproved-same-origin-policy',
                })
              }
            }
            for (const resolvedUrl of urlProperties.properties) {
              if (!resolvedUrl) continue
              const { property: urlProperty, request: urlRequest } = resolvedUrl
              const urlExpression =
                urlProperty.type === 'ObjectMethod'
                  ? urlProperty
                  : isSyntaxNode(urlProperty.value)
                    ? urlProperty.value
                    : undefined
              if (!urlExpression) continue
              const currentUrl = unwrapExpression(urlExpression)
              const urlResolver = requestObjectResolver(urlRequest)
              if (expressionContainsInternalRoute(currentUrl, urlResolver)) {
                detectedSelfHops += 1
                violations.push({
                  file,
                  line: urlProperty.loc?.start.line ?? requestProperty.loc?.start.line ?? 1,
                  toolId,
                  reason: 'same-origin-tool-request',
                })
              } else if (
                !hasLegacyInternalPolicy &&
                expressionContainsUnresolvedUrlHelper(currentUrl, urlResolver)
              ) {
                reportUnresolved(
                  urlProperty.loc?.start.line ?? requestProperty.loc?.start.line ?? 1
                )
              }
            }
          }
        }
      }
    }
    for (const child of getChildNodes(node)) visit(child)
  }
  visit(program)

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
          : violation.reason === 'legacy-internal-policy'
            ? 'request.internal is obsolete; use InternalToolConfig.operation for in-process work'
            : violation.reason === 'retired-direct-execution'
              ? 'directExecution is retired; use InternalToolConfig.operation and a registered server handler'
              : 'request configuration could not be audited; keep it in a statically resolvable local helper'
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
