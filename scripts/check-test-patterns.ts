#!/usr/bin/env bun
/**
 * Keeps the test suite on one set of patterns (see `.claude/rules/sim-testing.md`):
 *
 * - `global-remock`: an apps/sim unit test re-mocks a module `apps/sim/vitest.setup.ts` already
 *   mocks. Drive the global mock through its knobs instead.
 * - `local-factory`: a test hand-rolls a `vi.mock` factory for a module that has a central mock in
 *   `@sim/testing` (known from any test that mocks it with a `*Mock` imported from there).
 *   Integration and `*.live.test.ts` files bind real boundaries, so neither rule applies to them.
 * - `local-helper`: a test redefines a helper `@sim/testing` exports (only in workspaces that
 *   depend on `@sim/testing`).
 * - `redundant-hook`: an `afterEach`, or the leading statements of a `beforeEach`, make a call the
 *   shared Vitest config already makes before every test (`clearMocks`, `restoreMocks`,
 *   `unstubEnvs`, `unstubGlobals`). Integration files only get `clearMocks`, so only
 *   `vi.clearAllMocks()` is flagged there.
 * - `module-scope-stub`: a non-integration test calls `vi.stubGlobal`, `vi.stubEnv` or `vi.spyOn`
 *   at module scope, where the shared config undoes it before the first test.
 * - `test-dir`: a test lives in a `__tests__/` or `tests/` directory instead of next to its source.
 *
 * A central mock, or a global mock in `apps/sim/vitest.setup.ts`, that `vi.mock`s an `@/…` module
 * id that no longer resolves fails outright: it mocks nothing, and a dead central `@example` id
 * would register a dead module as covered.
 *
 * Existing exceptions are recorded in `scripts/test-patterns-baseline.json`. A new violation fails;
 * so does a baseline entry that no longer occurs, so the baseline only ever shrinks. Regenerate it
 * after removing violations with `bun run scripts/check-test-patterns.ts --update`.
 *
 * Run: `bun run check:test-patterns`
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(ROOT, 'scripts/test-patterns-baseline.json')
const SETUP = 'apps/sim/vitest.setup.ts'

/** Helpers exported by `@sim/testing` that tests must import rather than redefine. */
const SHARED_HELPERS = new Set([
  'jsonResponse',
  'createRouteContext',
  'createDeferred',
  'flushMicrotasks',
  'flushMacrotask',
  'collectStream',
])

/** Resets the shared config already runs before each test. Integration files only get `clearMocks`. */
const CONFIG_HOOK_CALLS = ['clearAllMocks', 'restoreAllMocks', 'unstubAllEnvs', 'unstubAllGlobals']
const INTEGRATION_CONFIG_HOOK_CALLS = ['clearAllMocks']

/** Calls the shared config undoes before each test (`restoreMocks`, `unstubEnvs`, `unstubGlobals`). */
const UNDONE_STUB_CALLS = ['stubGlobal', 'stubEnv', 'spyOn']

interface Violation {
  file: string
  rule: string
  detail: string
}

type Node = { type: string; [key: string]: unknown }

function walk(node: unknown, visit: (node: Node) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  const current = node as Node
  if (typeof current.type === 'string') visit(current)
  for (const [key, value] of Object.entries(current)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue
    walk(value, visit)
  }
}

export function parseSource(file: string, source: string) {
  return parse(source, {
    sourceType: 'module',
    plugins: [
      'typescript',
      ...(file.endsWith('x') ? (['jsx'] as const) : []),
      'topLevelAwait',
      'decorators',
    ],
    errorRecovery: true,
  }).program
}

function parseFile(file: string) {
  return parseSource(file, readFileSync(path.join(ROOT, file), 'utf8'))
}

function isViCall(node: Node, method: string): boolean {
  const callee = node.callee as Node | undefined
  return (
    node.type === 'CallExpression' &&
    callee?.type === 'MemberExpression' &&
    (callee.object as Node).type === 'Identifier' &&
    (callee.object as { name: string }).name === 'vi' &&
    (callee.property as { name?: string }).name === method
  )
}

/** Wrappers that leave the wrapped expression's value unchanged. */
const TRANSPARENT_WRAPPERS = new Set([
  'AwaitExpression',
  'ParenthesizedExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
])

function unwrap(node: Node | undefined): Node | undefined {
  let current = node
  while (current && TRANSPARENT_WRAPPERS.has(current.type)) {
    current = (current.type === 'AwaitExpression' ? current.argument : current.expression) as Node
  }
  return current
}

/**
 * The `vi.<method>` call at the root of a chain such as `vi.spyOn(a, 'b').mockReturnValue(c)`,
 * looking through awaits, parentheses and type assertions.
 */
function rootViMethod(node: Node | undefined, methods: string[]): string | undefined {
  let current = unwrap(node)
  while (current?.type === 'CallExpression') {
    const method = methods.find((name) => isViCall(current as Node, name))
    if (method) return method
    const callee = current.callee as Node
    current = callee.type === 'MemberExpression' ? unwrap(callee.object as Node) : undefined
  }
  return undefined
}

/**
 * `module-scope-stub` and `redundant-hook` violations in one test file. Both depend only on the
 * file itself, not on the setup file or central mocks.
 */
export function findStubAndHookViolations(
  file: string,
  program: ReturnType<typeof parseSource>
): Violation[] {
  const integration = file.endsWith('.integration.ts')
  const violations: Violation[] = []

  if (!integration) {
    for (const topLevel of program.body as Node[]) {
      const statement =
        topLevel.type === 'ExportNamedDeclaration' && topLevel.declaration
          ? (topLevel.declaration as Node)
          : topLevel
      const calls =
        statement.type === 'ExpressionStatement'
          ? [statement.expression as Node]
          : statement.type === 'VariableDeclaration'
            ? (statement.declarations as Node[]).map((declarator) => declarator.init as Node)
            : []
      for (const call of calls) {
        const method = rootViMethod(call, UNDONE_STUB_CALLS)
        if (method) violations.push({ file, rule: 'module-scope-stub', detail: `vi.${method}()` })
      }
    }
  }

  walk(program, (node) => {
    if (
      node.type !== 'CallExpression' ||
      (node.callee as Node).type !== 'Identifier' ||
      !['beforeEach', 'afterEach'].includes((node.callee as { name: string }).name)
    ) {
      return
    }
    const hook = (node.callee as { name: string }).name
    const callback = (node.arguments as Node[])[0]
    const body = callback?.body as Node | undefined
    const calls =
      body?.type === 'BlockStatement'
        ? (body.body as Node[]).map((statement) => statement.expression as Node | undefined)
        : [body]
    for (const call of calls) {
      const method = rootViMethod(
        call,
        integration ? INTEGRATION_CONFIG_HOOK_CALLS : CONFIG_HOOK_CALLS
      )
      if (method) {
        violations.push({ file, rule: 'redundant-hook', detail: `vi.${method}()` })
      } else if (hook === 'beforeEach') {
        // Past the first setup statement a reset can be deliberate: it discards the calls or
        // stubs that setup just made, which the config's earlier reset never saw.
        break
      }
    }
  })
  return violations
}

function mockedId(node: Node): string | undefined {
  if (!isViCall(node, 'mock')) return undefined
  const first = (node.arguments as Node[])[0]
  return first?.type === 'StringLiteral' ? (first as { value: string }).value : undefined
}

/**
 * A factory that uses a central mock as-is: `() => fooMock`, `() => ({ ...fooMock, override })`, or
 * `async () => (await import('@sim/testing/mocks/foo.mock')).fooMock`.
 */
function centralMockName(
  factory: Node | undefined,
  testingImports: Set<string>
): string | undefined {
  if (!factory || factory.type !== 'ArrowFunctionExpression') return undefined
  const body = factory.body as Node
  if (body.type === 'Identifier' && testingImports.has((body as { name: string }).name)) {
    return (body as { name: string }).name
  }
  const first = body.type === 'ObjectExpression' ? (body.properties as Node[])[0] : undefined
  const spread = first?.type === 'SpreadElement' ? (first.argument as Node) : undefined
  if (spread?.type === 'Identifier' && testingImports.has((spread as { name: string }).name)) {
    return (spread as { name: string }).name
  }
  const awaited = body.type === 'MemberExpression' ? (body.object as Node) : undefined
  if (awaited?.type === 'AwaitExpression' && importsTesting(awaited.argument as Node)) {
    return (body.property as { name: string }).name
  }
  return undefined
}

/** A dynamic `import('@sim/testing/…')`. */
function importsTesting(node: Node | undefined): boolean {
  const source =
    node?.type === 'CallExpression' && (node.callee as Node).type === 'Import'
      ? (node.arguments as Node[])[0]
      : node?.type === 'ImportExpression'
        ? (node.source as Node)
        : undefined
  return (
    source?.type === 'StringLiteral' &&
    (source as { value: string }).value.startsWith('@sim/testing')
  )
}

function testFiles(): string[] {
  return execFileSync('git', ['ls-files', '*.test.ts', '*.test.tsx', '*.integration.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
}

function globalMockIds(): Set<string> {
  const ids = new Set<string>()
  walk(parseFile(SETUP), (node) => {
    const id = mockedId(node)
    if (id) ids.add(id)
  })
  return ids
}

const workspaceUsesTesting = new Map<string, boolean>()

/** Whether the file's workspace depends on `@sim/testing` — only those can adopt a central mock. */
function canUseSharedMocks(file: string): boolean {
  const workspace = file.split('/').slice(0, 2).join('/')
  let uses = workspaceUsesTesting.get(workspace)
  if (uses === undefined) {
    try {
      const manifest = JSON.parse(readFileSync(path.join(ROOT, workspace, 'package.json'), 'utf8'))
      uses = Boolean(
        manifest.dependencies?.['@sim/testing'] ?? manifest.devDependencies?.['@sim/testing']
      )
    } catch {
      uses = false
    }
    workspaceUsesTesting.set(workspace, uses)
  }
  return uses
}

const CENTRAL_MOCKS_DIR = 'packages/testing/src/mocks'

/** Whether an apps/sim `@/…` module id resolves to a file, the way its tsconfig paths map it. */
function resolvesInSim(id: string): boolean {
  const base = path.join(ROOT, 'apps/sim', id.slice(2))
  return ['.ts', '.tsx', '/index.ts', '/index.tsx'].some((suffix) => existsSync(base + suffix))
}

/**
 * Module ids the central mocks declare — each `packages/testing/src/mocks/*.mock.ts` documents its
 * target in an `@example` `vi.mock('<id>', () => xMock)` line. Reading the declarations (not just
 * current usages) keeps a module covered after its last conforming usage disappears. Also returns
 * every `vi.mock` of an `@/…` id in those files that does not resolve.
 */
function readCentralMocks(): { declared: Set<string>; unresolved: string[] } {
  const declared = new Set<string>()
  const unresolved: string[] = []
  const dir = path.join(ROOT, CENTRAL_MOCKS_DIR)
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.mock.ts')) continue
    const source = readFileSync(path.join(dir, name), 'utf8')
    for (const match of source.matchAll(
      /vi\.mock\(\s*['"]([^'"]+)['"],\s*(?:async\s*)?\(\)\s*=>\s*(?:\(\{\s*\.\.\.)?(?:\(await import\([^)]*\)\)\.)?\w+Mock\b/g
    )) {
      declared.add(match[1])
    }
    for (const match of source.matchAll(/vi\.mock\(\s*['"](@\/[^'"]+)['"]/g)) {
      if (!resolvesInSim(match[1])) unresolved.push(`${CENTRAL_MOCKS_DIR}/${name}: ${match[1]}`)
    }
  }
  return { declared, unresolved }
}

function collect(globals: Set<string>, declaredCentralIds: Set<string>): Violation[] {
  const files = testFiles()
  const parsed = files.map((file) => ({ file, program: parseFile(file) }))

  const testingImportsByFile = new Map<string, Set<string>>()
  const centralIds = new Set<string>([...globals, ...declaredCentralIds])
  for (const { file, program } of parsed) {
    const imports = new Set<string>()
    for (const statement of program.body) {
      if (
        statement.type === 'ImportDeclaration' &&
        statement.source.value.startsWith('@sim/testing')
      ) {
        for (const specifier of statement.specifiers) imports.add(specifier.local.name)
      }
    }
    testingImportsByFile.set(file, imports)
    walk(program, (node) => {
      const id = mockedId(node)
      if (id && centralMockName((node.arguments as Node[])[1], imports)) centralIds.add(id)
    })
  }

  const violations: Violation[] = []
  for (const { file, program } of parsed) {
    const realBoundary = file.endsWith('.integration.ts') || file.endsWith('.live.test.ts')
    const imports = testingImportsByFile.get(file) ?? new Set<string>()

    if (/(^|\/)(__tests__|tests)\//.test(file)) {
      violations.push({ file, rule: 'test-dir', detail: path.dirname(file) })
    }

    violations.push(...findStubAndHookViolations(file, program))

    walk(program, (node) => {
      const id = mockedId(node)
      if (id) {
        const factory = (node.arguments as Node[])[1]
        const central = centralMockName(factory, imports)
        if (!realBoundary && file.startsWith('apps/sim/') && globals.has(id)) {
          violations.push({ file, rule: 'global-remock', detail: id })
        } else if (
          !realBoundary &&
          factory &&
          !central &&
          centralIds.has(id) &&
          canUseSharedMocks(file)
        ) {
          violations.push({ file, rule: 'local-factory', detail: id })
        }
      }

      if (
        (node.type === 'FunctionDeclaration' || node.type === 'VariableDeclarator') &&
        (node.id as Node | undefined)?.type === 'Identifier'
      ) {
        const name = (node.id as { name: string }).name
        if (SHARED_HELPERS.has(name) && !imports.has(name) && canUseSharedMocks(file)) {
          violations.push({ file, rule: 'local-helper', detail: name })
        }
      }
    })
  }
  return violations
}

function key(violation: Violation): string {
  return `${violation.rule}\t${violation.file}\t${violation.detail}`
}

/**
 * The committed baseline. A missing file fails closed: restore it from git. `--update --init`
 * is the only way to create one, and it accepts every current violation.
 */
function readBaseline(current: string[]): string[] {
  if (existsSync(BASELINE)) return JSON.parse(readFileSync(BASELINE, 'utf8'))
  if (process.argv.includes('--update') && process.argv.includes('--init')) return current
  console.error(
    `✗ ${path.relative(ROOT, BASELINE)} is missing. Restore it from git; ` +
      'create a new one only with --update --init.'
  )
  process.exit(1)
}

/** How to fix each rule, printed once per rule with new violations. */
const FIX: Record<string, string> = {
  'global-remock': 'drive the global mock through its knobs instead of re-mocking it',
  'local-factory': 'use the central mock from @sim/testing',
  'local-helper': 'import the helper from @sim/testing',
  'redundant-hook': 'delete the call; the shared Vitest config already makes it before every test',
  'module-scope-stub':
    'move the stub into a beforeEach or the test; the shared config undoes it before the first test',
  'test-dir': 'move the test next to its source file',
}

/** Prints each new violation, then the fix for every rule involved. */
function reportAdded(added: string[]): void {
  const rules = new Set<string>()
  for (const entry of added) {
    const [rule, file, detail] = entry.split('\t')
    rules.add(rule)
    console.error(`✗ ${rule}: ${file} (${detail})`)
  }
  console.error(
    `\n${added.length} new test-pattern violation(s) — see .claude/rules/sim-testing.md:`
  )
  for (const rule of rules) console.error(`  ${rule}: ${FIX[rule]}`)
}

function main(): void {
  const globalIds = globalMockIds()
  const centralMocks = readCentralMocks()
  const deadMockTargets = [
    ...centralMocks.unresolved,
    ...[...globalIds]
      .filter((id) => id.startsWith('@/') && !resolvesInSim(id))
      .map((id) => `${SETUP}: ${id}`),
  ]
  if (deadMockTargets.length) {
    for (const entry of deadMockTargets) console.error(`✗ dead mock target: ${entry}`)
    console.error(
      '\nA shared mock mocks a module id that no longer resolves. Point it at the moved module, or ' +
        'delete the mock if the module is gone.'
    )
    process.exit(1)
  }

  const violations = collect(globalIds, centralMocks.declared)
  const current = [...new Set(violations.map(key))].sort()

  const baseline = new Set<string>(readBaseline(current))
  const added = current.filter((entry) => !baseline.has(entry))

  if (process.argv.includes('--update')) {
    // Shrink-only: drop fixed entries, never admit a new one, and write nothing if refusing.
    if (added.length) {
      reportAdded(added)
      process.exit(1)
    }
    const kept = current.filter((entry) => baseline.has(entry))
    writeFileSync(BASELINE, `${JSON.stringify(kept, null, 2)}\n`)
    console.log(`Wrote ${kept.length} baseline entries to ${path.relative(ROOT, BASELINE)}`)
    process.exit(0)
  }
  const currentSet = new Set(current)
  const stale = [...baseline].filter((entry) => !currentSet.has(entry))

  if (added.length || stale.length) {
    if (added.length) reportAdded(added)
    if (stale.length) {
      console.error(
        `\n${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} fixed — shrink the ` +
          'baseline: bun run scripts/check-test-patterns.ts --update'
      )
    }
    process.exit(1)
  }

  console.log(`✓ test patterns (${current.length} baselined exceptions)`)
}

if (import.meta.main) main()
