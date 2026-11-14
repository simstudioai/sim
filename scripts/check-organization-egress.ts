#!/usr/bin/env bun
/**
 * Keeps requests made on a workspace's behalf on the organization's egress route.
 *
 * An organization with a dedicated egress gateway gets static IPs that its vendors and its own
 * tenants allowlist. That only holds if Sim's request reaches the network through
 * `outboundFetch` (`apps/sim/lib/core/network/outbound-fetch.server.ts`), or one of the
 * SSRF-guarded helpers, which pick the gateway from the current outbound scope. The global
 * `fetch` never does: a token mint, OAuth refresh or tool call written with it leaves from Sim's
 * shared IPs, and a customer who locked their endpoint to their own IPs sees a 403 that no test
 * catches, because the code works everywhere else.
 *
 * So inside the directories whose code acts for a workspace (credentials, OAuth, integration
 * clients, tools, webhooks, providers and connectors), a call to the global `fetch` fails this
 * check. A call that rightly goes direct (an operator-local server such as Ollama, or a public
 * catalog read with no workspace behind it) takes `// egress-direct: <reason>` on one of the two
 * lines above it. A method named `fetch` on a client class is not the global and is ignored.
 *
 * Parsed with the TypeScript AST, so `fetch` inside strings, comments and tool descriptions is
 * never reported. The tree was swept when this landed, so there is no baseline.
 *
 * Usage: bun run check:organization-egress
 */
import type { Dirent } from 'node:fs'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from '@typescript/typescript6'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Code under these directories makes requests for a workspace or organization. */
const SCAN_DIRS = [
  'apps/sim/connectors',
  'apps/sim/providers',
  'apps/sim/tools',
  'apps/sim/lib/auth/connectors',
  'apps/sim/lib/credential-groups',
  'apps/sim/lib/credentials',
  'apps/sim/lib/data-drains',
  'apps/sim/lib/embeddings',
  'apps/sim/lib/internal',
  'apps/sim/lib/knowledge',
  'apps/sim/lib/managed-agents',
  'apps/sim/lib/media',
  'apps/sim/lib/oauth',
  'apps/sim/lib/selectors',
  'apps/sim/lib/webhooks',
]

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  'client',
  '__fixtures__',
])
const ANNOTATION = '// egress-direct:'
const ANNOTATION_REACH = 2

export interface DirectFetch {
  line: number
  text: string
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    throw new Error(`check-organization-egress: SCAN_DIRS entry "${dir}" does not exist`)
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.ts$/.test(entry.name) && !/\.(test|integration|live\.test)\.ts$/.test(entry.name))
      out.push(full)
  }
  return out
}

function bindsName(name: ts.BindingName, target: string): boolean {
  if (ts.isIdentifier(name)) return name.text === target
  return name.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindsName(element.name, target)
  )
}

/** Whether this scope node itself declares a binding called `target`. */
function declares(scope: ts.Node, target: string): boolean {
  if (ts.isFunctionLike(scope)) {
    if (scope.parameters.some((parameter) => bindsName(parameter.name, target))) return true
  }
  const statements =
    ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope) ? scope.statements : []
  return statements.some((statement) => {
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some((d) => bindsName(d.name, target))
    }
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      return statement.name?.text === target
    }
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      if (!clause) return false
      if (clause.name?.text === target) return true
      const bindings = clause.namedBindings
      if (!bindings) return false
      if (ts.isNamespaceImport(bindings)) return bindings.name.text === target
      return bindings.elements.some((element) => element.name.text === target)
    }
    return false
  })
}

/** Whether `name` here refers to a local declaration rather than the global. */
function shadowsGlobal(node: ts.Node, name: string): boolean {
  for (let scope: ts.Node | undefined = node.parent; scope; scope = scope.parent) {
    if (declares(scope, name)) return true
  }
  return false
}

const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self', 'global'])

/**
 * Whether this `fetch` identifier is a value reference to the global: a call, but also an alias
 * (`const f = fetch`), a fallback (`custom ?? fetch`), a shorthand property (`{ fetch }`) or a
 * default parameter. Names in declarations, property keys, member names and type positions are
 * not references.
 */
function refersToGlobalFetch(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isExportSpecifier(parent) ||
      ts.isImportClause(parent)) &&
    parent.name === node
  ) {
    return false
  }
  if (ts.isQualifiedName(parent) && parent.right === node) return false
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false
  if (ts.isTypeQueryNode(parent) || ts.isTypeReferenceNode(parent)) return false
  return !shadowsGlobal(node, 'fetch')
}

/**
 * Every reference to the global `fetch` (a call, an alias, `globalThis.fetch`, `window['fetch']`)
 * without an `egress-direct` annotation on one of the two lines above it.
 */
export function findDirectFetches(file: string, source: string): DirectFetch[] {
  if (!source.includes('fetch')) return []
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const lines = source.split('\n')
  const found: DirectFetch[] = []

  const report = (node: ts.Node) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
    const annotated = lines
      .slice(Math.max(0, line - ANNOTATION_REACH), line)
      .some((text) => text.trim().startsWith(ANNOTATION))
    if (!annotated) found.push({ line: line + 1, text: lines[line].trim() })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === 'fetch' && refersToGlobalFetch(node)) report(node)
    else if (
      (ts.isPropertyAccessExpression(node) && node.name.text === 'fetch') ||
      (ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === 'fetch')
    ) {
      if (ts.isIdentifier(node.expression) && GLOBAL_OBJECTS.has(node.expression.text)) {
        report(node)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

function main() {
  const violations: Array<DirectFetch & { file: string }> = []
  let scanned = 0
  for (const scanDir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, scanDir))) {
      scanned++
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      for (const hit of findDirectFetches(rel, readFileSync(file, 'utf8'))) {
        violations.push({ file: rel, ...hit })
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `✓ check-organization-egress: ${scanned} files, every request is organization-routed`
    )
    process.exit(0)
  }

  console.error('✗ check-organization-egress: global fetch in code that acts for a workspace\n')
  for (const violation of violations) {
    console.error(`    ${violation.file}:${violation.line}`)
    console.error(`      ${violation.text}`)
  }
  console.error(
    "\n  The global fetch always leaves from Sim's shared IPs, so an organization with a\n" +
      '  dedicated egress gateway loses its static IPs for this request. Use outboundFetch from\n' +
      '  @/lib/core/network/outbound-fetch.server (same signature as fetch). If the destination\n' +
      "  is genuinely not on the organization's behalf (an operator-local server, a public\n" +
      '  catalog), mark the call with `// egress-direct: <reason>` on the line above it.\n'
  )
  process.exit(1)
}

if (import.meta.main) main()
