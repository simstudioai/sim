#!/usr/bin/env bun
/**
 * Keeps the test suite on one set of patterns (see `.claude/rules/sim-testing.md`):
 *
 * - `global-remock`: an apps/sim unit test re-mocks a module `apps/sim/vitest.setup.ts` already
 *   mocks. Drive the global mock through its knobs instead.
 * - `local-factory`: a test hand-rolls a `vi.mock` factory for a module that has a central mock in
 *   `@sim/testing` (known from any test that mocks it with a `*Mock` imported from there).
 * - `local-helper`: a test redefines a helper `@sim/testing` exports.
 * - `redundant-hook`: a `beforeEach`/`afterEach` starts with a call the shared Vitest config
 *   already makes (`clearMocks`, `restoreMocks`, `unstubEnvs`, `unstubGlobals`). Integration files
 *   only get `clearMocks`, so only `vi.clearAllMocks()` is flagged there.
 * - `test-dir`: a test lives in a `__tests__/` or `tests/` directory instead of next to its source.
 *
 * Existing exceptions are recorded in `scripts/test-patterns-baseline.json`. A new violation fails;
 * so does a baseline entry that no longer occurs, so the baseline only ever shrinks. Regenerate it
 * after removing violations with `bun run scripts/check-test-patterns.ts --update`.
 *
 * Run: `bun run check:test-patterns`
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'

const ROOT = path.resolve(import.meta.dir, '..')
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

const CONFIG_HOOK_CALLS = new Set([
  'clearAllMocks',
  'restoreAllMocks',
  'unstubAllEnvs',
  'unstubAllGlobals',
])

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

function parseFile(file: string) {
  const source = readFileSync(path.join(ROOT, file), 'utf8')
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

/**
 * Module ids the central mocks declare — each `packages/testing/src/mocks/*.mock.ts` documents its
 * target in an `@example` `vi.mock('<id>', () => xMock)` line. Reading the declarations (not just
 * current usages) keeps a module covered after its last conforming usage disappears.
 */
function declaredCentralMockIds(): Set<string> {
  const ids = new Set<string>()
  const dir = path.join(ROOT, 'packages/testing/src/mocks')
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.mock.ts')) continue
    for (const match of readFileSync(path.join(dir, name), 'utf8').matchAll(
      /vi\.mock\(\s*['"]([^'"]+)['"],\s*(?:async\s*)?\(\)\s*=>\s*(?:\(\{\s*\.\.\.)?(?:\(await import\([^)]*\)\)\.)?\w+Mock\b/g
    )) {
      ids.add(match[1])
    }
  }
  return ids
}

function collect(): Violation[] {
  const files = testFiles()
  const globals = globalMockIds()
  const parsed = files.map((file) => ({ file, program: parseFile(file) }))

  const testingImportsByFile = new Map<string, Set<string>>()
  const centralIds = new Set<string>([...globals, ...declaredCentralMockIds()])
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
    const integration = file.endsWith('.integration.ts')
    const imports = testingImportsByFile.get(file) ?? new Set<string>()

    if (/(^|\/)(__tests__|tests)\//.test(file)) {
      violations.push({ file, rule: 'test-dir', detail: path.dirname(file) })
    }

    walk(program, (node) => {
      const id = mockedId(node)
      if (id) {
        const factory = (node.arguments as Node[])[1]
        const central = centralMockName(factory, imports)
        if (!integration && file.startsWith('apps/sim/') && globals.has(id)) {
          violations.push({ file, rule: 'global-remock', detail: id })
        } else if (
          !integration &&
          factory &&
          !central &&
          centralIds.has(id) &&
          canUseSharedMocks(file)
        ) {
          violations.push({ file, rule: 'local-factory', detail: id })
        }
      }

      if (
        node.type === 'CallExpression' &&
        (node.callee as Node).type === 'Identifier' &&
        ['beforeEach', 'afterEach'].includes((node.callee as { name: string }).name)
      ) {
        const callback = (node.arguments as Node[])[0]
        const body = callback?.body as Node | undefined
        const first =
          body?.type === 'BlockStatement'
            ? ((body.body as Node[])[0]?.expression as Node | undefined)
            : body
        if (first?.type !== 'CallExpression') return
        for (const method of CONFIG_HOOK_CALLS) {
          if (integration && method !== 'clearAllMocks') continue
          if (isViCall(first, method)) {
            violations.push({ file, rule: 'redundant-hook', detail: `vi.${method}()` })
          }
        }
      }

      if (
        (node.type === 'FunctionDeclaration' || node.type === 'VariableDeclarator') &&
        (node.id as Node | undefined)?.type === 'Identifier'
      ) {
        const name = (node.id as { name: string }).name
        if (SHARED_HELPERS.has(name) && !imports.has(name)) {
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

const violations = collect()
const current = [...new Set(violations.map(key))].sort()

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`)
  console.log(`Wrote ${current.length} baseline entries to ${path.relative(ROOT, BASELINE)}`)
  process.exit(0)
}

const baseline = new Set<string>(JSON.parse(readFileSync(BASELINE, 'utf8')))
const added = current.filter((entry) => !baseline.has(entry))
const currentSet = new Set(current)
const stale = [...baseline].filter((entry) => !currentSet.has(entry))

if (added.length || stale.length) {
  for (const entry of added) {
    const [rule, file, detail] = entry.split('\t')
    console.error(`✗ ${rule}: ${file} (${detail})`)
  }
  if (added.length) {
    console.error(
      `\n${added.length} new test-pattern violation(s). Use the central mock/helper from @sim/testing ` +
        'or drive the global mock — see .claude/rules/sim-testing.md.'
    )
  }
  if (stale.length) {
    console.error(
      `\n${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} fixed — shrink the ` +
        'baseline: bun run scripts/check-test-patterns.ts --update'
    )
  }
  process.exit(1)
}

console.log(`✓ test patterns (${current.length} baselined exceptions)`)
