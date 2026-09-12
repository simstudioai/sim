#!/usr/bin/env bun
/**
 * Keeps outbound HTTP behind the egress guard.
 *
 * Every request Sim makes to a user- or model-influenced destination has to go
 * through `lib/core/security/egress`, which resolves DNS, classifies each
 * address against the deployment's policy, and pins the connection to the
 * address it approved. A module that reaches for `node:http`, `node:https`, or
 * `undici` directly gets none of that, and the omission is invisible — the code
 * works, it just has no guard.
 *
 * This checks the module edge rather than the call, because that is the part
 * that cannot be hidden behind a helper.
 *
 * Parsed with the TypeScript AST rather than matched with a regex. Two rounds of
 * review found regex holes in both directions — a comment or string naming a
 * transport reported a violation that was not there, and a regex literal
 * containing a quote hid a real one — which is what a scanner that does not
 * understand the grammar will keep doing.
 *
 * Bare `fetch()` is additionally forbidden in the managed provider modules.
 * Elsewhere bare `fetch()` is not checked. It is used constantly for same-origin and
 * server-action calls where the guard does not apply, so flagging it would be
 * noise. The transports it can reach are covered by the rules below.
 *
 * Usage: bun run scripts/check-egress-boundary.ts
 */
import type { Dirent } from 'node:fs'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from '@typescript/typescript6'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SCAN_DIRS = [
  'apps/sim/app',
  'apps/sim/background',
  'apps/sim/blocks',
  'apps/sim/connectors',
  'apps/sim/executor',
  'apps/sim/lib',
  'apps/sim/providers',
  'apps/sim/tools',
  'apps/sim/triggers',
]

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage'])

/** Modules that can open a socket directly. */
const TRANSPORTS = new Set([
  'http',
  'https',
  'http2',
  'node:http',
  'node:https',
  'node:http2',
  'undici',
  'undici/index.js',
  'http-proxy-agent',
  'https-proxy-agent',
  // Present in node_modules as transitive dependencies. Nothing scanned imports
  // them today; listing them keeps that true.
  'axios',
  'node-fetch',
  'got',
  'superagent',
])

/**
 * Modules allowed to hold a transport import, each because it *is* part of the
 * guard or predates it for a documented reason.
 */
const ALLOWED = new Set([
  /** Subprocess-only runtime fixture; never imported by production modules. */
  'apps/sim/lib/core/network/fixtures/gateway-runtime.fixture.ts',
  // The guard itself: resolves, classifies, pins, and follows redirects.
  'apps/sim/lib/core/security/input-validation.server.ts',
  /** TLS CONNECT implementation; accepts only classified IPs from the shared guard. */
  'apps/sim/lib/core/network/gateway.server.ts',
  /** Owns route-specific pools and emits requests for the HTTP and SDK adapters. */
  'apps/sim/lib/core/network/transport.server.ts',
  // Streaming MCP transport, built on the guard's pinned dispatcher.
  'apps/sim/lib/mcp/pinned-fetch.ts',
  // Builds a dispatcher to carry a caller's deadline; issues no request itself.
  'apps/sim/lib/core/utils/fetch-deadline.ts',
])

function walk(dir: string, out: string[] = []): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    throw new Error(`check-egress-boundary: SCAN_DIRS entry "${dir}" does not exist`)
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|integration)\.tsx?$/.test(entry.name))
      out.push(full)
  }
  return out
}

interface Violation {
  file: string
  line: number
  kind: string
  specifier: string
}

/**
 * Whether TypeScript drops this import at emit, leaving nothing that could load
 * the module.
 *
 * True for `import type … from 'm'` and for a named import whose every binding
 * is marked `type` — the repo compiles with `verbatimModuleSyntax: false`, so
 * that form is elided rather than kept as a side-effect import. A default or
 * namespace binding is a value and keeps the import alive, and a bare
 * `import 'm'` has no clause at all and always runs.
 */
function isElidedImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause
  if (!clause) return false
  if (clause.isTypeOnly) return true
  if (clause.name) return false

  const bindings = clause.namedBindings
  if (!bindings || !ts.isNamedImports(bindings)) return false
  return bindings.elements.every((element) => element.isTypeOnly)
}

/**
 * Whether TypeScript drops this re-export at emit.
 *
 * True for `export type { … } from 'm'` and for a named re-export whose every
 * specifier is marked `type`. `export * from 'm'` re-exports values and always
 * runs the module.
 */
function isElidedExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true

  const clause = node.exportClause
  if (!clause || !ts.isNamedExports(clause)) return false
  return clause.elements.every((element) => element.isTypeOnly)
}

/**
 * Every runtime reference to a transport module. An import TypeScript elides is
 * skipped: it has no runtime presence and cannot open anything.
 */
function findTransportLoads(file: string, source: string): Array<Omit<Violation, 'file'>> {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false)
  const found: Array<Omit<Violation, 'file'>> = []

  const record = (node: ts.Node, specifier: string, kind: string) => {
    if (!TRANSPORTS.has(specifier)) return
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    found.push({ line: line + 1, kind, specifier })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      if (!isElidedImport(node)) {
        record(node, node.moduleSpecifier.text, node.importClause ? 'import' : 'side-effect import')
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      !isElidedExport(node)
    ) {
      record(node, node.moduleSpecifier.text, 're-export')
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      const argument = node.arguments[0]
      if ((isDynamicImport || isRequire) && argument && ts.isStringLiteralLike(argument)) {
        record(node, argument.text, isDynamicImport ? 'dynamic import' : 'require')
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

export function mayLoadTransport(source: string): boolean {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    source
  )
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      (token === ts.SyntaxKind.StringLiteral ||
        token === ts.SyntaxKind.NoSubstitutionTemplateLiteral) &&
      TRANSPORTS.has(scanner.getTokenValue())
    ) {
      return true
    }
  }
  return false
}

/** Provider modules must keep native fetch behind the organization-aware transport. */
const MANAGED_FETCH_ROOTS = [
  'apps/sim/connectors/',
  'apps/sim/providers/',
  'apps/sim/tools/',
  'apps/sim/lib/internal/',
  'apps/sim/lib/atlassian/',
  'apps/sim/lib/oauth/',
  'apps/sim/lib/embeddings/',
  'apps/sim/lib/knowledge/',
  'apps/sim/lib/credentials/',
  'apps/sim/lib/credential-groups/',
  'apps/sim/lib/selectors/server/providers/',
  'apps/sim/lib/webhooks/providers/',
  'apps/sim/lib/webhooks/polling/',
  'apps/sim/lib/media/',
  'apps/sim/lib/messaging/email/providers/',
]

/**
 * Account connection and revocation retain deployment networking: an account can
 * span organizations, and initial callbacks have no authorized resource scope.
 * Exempt only these entry points; runtime provider calls and refresh remain checked.
 */
const ACCOUNT_LIFECYCLE_FETCHES = new Map<string, ReadonlySet<string>>([
  [
    'apps/sim/lib/oauth/github-repositories.ts',
    new Set(['verifyGitHubRepositoriesIdentity', 'createGitHubRepositoriesProvider']),
  ],
  ['apps/sim/lib/oauth/monday.ts', new Set(['exchangeMondayAuthorizationCode'])],
  ['apps/sim/lib/oauth/shopify.ts', new Set(['completeShopifyOAuthConnection'])],
  ['apps/sim/lib/oauth/quickbooks.ts', new Set(['revokeQuickBooksToken'])],
])

/** Includes native fetch handed to SDKs or aliases; object methods and types are not transports. */
export function findNativeProviderFetches(source: string, file?: string): number[] {
  const ast = ts.createSourceFile('provider.ts', source, ts.ScriptTarget.Latest, true)
  const accountLifecycleFunctions = file ? ACCOUNT_LIFECYCLE_FETCHES.get(file) : undefined
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return
    const parent = node.parent
    const globalFetch =
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      ['globalThis', 'global'].includes(node.expression.text) &&
      (ts.isPropertyAccessExpression(node)
        ? node.name.text === 'fetch'
        : ts.isStringLiteralLike(node.argumentExpression) &&
          node.argumentExpression.text === 'fetch')
    const bareFetch =
      ts.isIdentifier(node) &&
      node.text === 'fetch' &&
      !ts.isImportSpecifier(parent) &&
      !ts.isExportSpecifier(parent) &&
      !ts.isBindingElement(parent) &&
      !(ts.isPropertyAccessExpression(parent) && parent.name === node) &&
      !(
        (ts.isPropertyAssignment(parent) ||
          ts.isMethodDeclaration(parent) ||
          ts.isVariableDeclaration(parent) ||
          ts.isParameter(parent) ||
          ts.isFunctionDeclaration(parent) ||
          ts.isPropertySignature(parent) ||
          ts.isMethodSignature(parent)) &&
        parent.name === node
      )
    const globalBinding =
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      ['globalThis', 'global'].includes(node.initializer.text) &&
      node.name.elements.some((element) => {
        const key = element.propertyName ?? element.name
        return (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && key.text === 'fetch'
      })
    if (globalFetch || bareFetch || globalBinding) {
      let boundary: ts.Node = node
      while (boundary.parent && !ts.isSourceFile(boundary.parent)) boundary = boundary.parent
      const functionName = ts.isFunctionDeclaration(boundary) ? boundary.name?.text : undefined
      if (!functionName || !accountLifecycleFunctions?.has(functionName)) {
        lines.push(ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1)
      }
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return lines
}

function main() {
  const violations: Violation[] = []
  let scanned = 0

  for (const scanDir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, scanDir))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      if (ALLOWED.has(rel)) continue
      scanned++
      const source = readFileSync(file, 'utf8')
      if (MANAGED_FETCH_ROOTS.some((root) => rel.startsWith(root))) {
        for (const line of findNativeProviderFetches(source, rel))
          violations.push({
            file: rel,
            line,
            kind: 'native fetch',
            specifier: 'Use secureFetchWithValidation or a profile-aware guarded fetch factory',
          })
      }
      if (!mayLoadTransport(source)) continue
      for (const load of findTransportLoads(rel, source)) {
        violations.push({ file: rel, ...load })
      }
    }
  }

  if (violations.length === 0) {
    console.log(`✓ check-egress-boundary: ${scanned} files, no unguarded HTTP transports`)
    process.exit(0)
  }

  console.error('✗ check-egress-boundary: raw HTTP transport outside the egress guard\n')
  for (const violation of violations) {
    console.error(`    ${violation.file}:${violation.line}  (${violation.kind})`)
    console.error(`      ${violation.specifier}`)
  }
  console.error(
    '\n  These modules can open a socket without resolving and classifying the\n' +
      '  destination first, so a user- or model-supplied URL reaches the network\n' +
      '  unchecked. Use secureFetchWithValidation (or secureFetchWithPinnedIP with\n' +
      '  a validated address) from @/lib/core/security/input-validation.server and\n' +
      '  pass the egress profile describing where the URL came from.\n'
  )
  process.exit(1)
}

if (import.meta.main) main()
