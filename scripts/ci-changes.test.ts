import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../', import.meta.url))
const script = resolve(root, '.github/scripts/ci-changes.sh')
const fixtures: string[] = []
interface Plan {
  flags: Record<string, boolean>
  fallback?: string
  http: { group: string }[]
  production: { group: string }[]
  typecheckPackages: string[]
  testPackages: string[]
}
function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}
function write(repo: string, file: string, content: string) {
  mkdirSync(dirname(join(repo, file)), { recursive: true })
  writeFileSync(join(repo, file), content)
}
/** Real Git and Turbo fixture: changed files, transitive packages, and configured task boundaries. */
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'ci-changes-'))
  fixtures.push(repo)
  git(repo, 'init', '--quiet')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  git(repo, 'config', 'commit.gpgsign', 'false')
  write(
    repo,
    'package.json',
    JSON.stringify({
      name: 'ci-fixture',
      private: true,
      packageManager: 'bun@1.4.2',
      workspaces: ['apps/*', 'packages/*'],
    })
  )
  const packages = [
    ['apps/sim', '@sim/app', { '@sim/auth': 'workspace:*', '@sim/db': 'workspace:*' }],
    ['apps/realtime', '@sim/realtime', { '@sim/auth': 'workspace:*' }],
    ['apps/desktop', '@sim/desktop', {}],
    ['apps/docs', 'docs', {}],
    ['packages/auth', '@sim/auth', { '@sim/security': 'workspace:*' }],
    ['packages/security', '@sim/security', {}],
    ['packages/db', '@sim/db', {}],
    ['packages/ts-sdk', 'simstudio-ts-sdk', {}],
    ['packages/sim-cli', 'sim', {}],
  ] as const
  const appScripts = JSON.parse(
    readFileSync(resolve(root, 'apps/sim/package.json'), 'utf8')
  ).scripts
  const workspaces: Record<string, unknown> = { '': { name: 'ci-fixture' } }
  for (const [path, name, dependencies] of packages) {
    const scripts: Record<string, string> = {
      test: 'echo test',
      build: 'echo build',
      'type-check': 'echo types',
    }
    if (name === '@sim/app')
      for (const key of Object.keys(appScripts))
        if (key.startsWith('ci:')) scripts[key] = 'echo fixture'
    write(
      repo,
      `${path}/package.json`,
      JSON.stringify({ name, version: '1.0.0', scripts, dependencies })
    )
    write(repo, `${path}/src/index.ts`, 'export const value = 1\n')
    workspaces[path] = { name, version: '1.0.0', dependencies }
  }
  write(
    repo,
    'bun.lock',
    JSON.stringify({ lockfileVersion: 1, configVersion: 1, workspaces, packages: {} })
  )
  for (const file of [
    'turbo.json',
    'apps/sim/turbo.json',
    '.github/ci-suites.json',
    '.github/scripts/ci-plan.gql',
  ]) {
    mkdirSync(dirname(join(repo, file)), { recursive: true })
    copyFileSync(resolve(root, file), join(repo, file))
  }
  git(repo, 'add', '-A')
  git(repo, 'commit', '--quiet', '-m', 'base')
  return { repo, base: git(repo, 'rev-parse', 'HEAD') }
}
function classify(repo: string, base: string): Plan {
  const report = join(repo, 'plan.json')
  const result = spawnSync('bash', [script, base], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${resolve(root, 'node_modules/.bin')}:${process.env.PATH}`,
      CI_PLAN_PATH: report,
    },
  })
  expect(result.status, result.stderr).toBe(0)
  const plan: Plan = JSON.parse(readFileSync(report, 'utf8'))
  for (const [flag, value] of Object.entries(plan.flags))
    expect(result.stdout).toContain(`${flag}=${value}\n`)
  return plan
}
function classifyFiles(files: string[]): Plan {
  const { repo, base } = fixture()
  for (const file of files) write(repo, file, `${file}\n`)
  git(repo, 'add', '-A')
  git(repo, 'commit', '--quiet', '-m', 'change')
  return classify(repo, base)
}
function groups(plan: Plan) {
  return [...new Set([...plan.http, ...plan.production].map((suite) => suite.group))].sort()
}
afterEach(() => {
  for (const repo of fixtures.splice(0)) rmSync(repo, { recursive: true, force: true })
})
describe('CI task attribution through real Turborepo', () => {
  it('runs SDK tests without provisioning the app, browsers, or database', () => {
    const plan = classifyFiles(['packages/ts-sdk/src/index.ts'])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual([])
    expect(plan.testPackages).toEqual(['simstudio-ts-sdk'])
    expect(plan.typecheckPackages).toEqual(['simstudio-ts-sdk'])
    expect(plan.flags).toMatchObject({
      test: true,
      test_app: false,
      integration: false,
      build: false,
      desktop_live: false,
      e2e_build: false,
    })
  })
  it('selects integration and browser checks for workspace code shared with desktop execution', () => {
    const plan = classifyFiles([
      'apps/sim/app/workspace/[workspaceId]/home/hooks/stream/dispatch-stream-event.ts',
    ])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual(['mobile', 'seo'])
    expect(plan.flags).toMatchObject({
      desktop_live: true,
      integration: true,
      test_app: true,
      build: true,
      e2e_build: true,
    })
  })
  it('selects SEO and rendering checks for content without database or Electron suites', () => {
    const plan = classifyFiles(['apps/sim/content/library/example/index.mdx'])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual(['seo'])
    expect(plan.flags).toMatchObject({
      integration: false,
      desktop_live: false,
      test_app: true,
      build: true,
    })
  })
  it.each([
    'apps/sim/app/workspace/[workspaceId]/upgrade/components/comparison-table/comparison-data.ts',
    'apps/sim/providers/models.ts',
    'apps/sim/blocks/registry.ts',
  ])('runs SEO when landing pages consume changed workspace or backend code: %s', (file) => {
    const plan = classifyFiles([file])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toContain('seo')
  })
  it('preserves the implicit app test dependency on docs content', () => {
    const plan = classifyFiles(['apps/docs/content/docs/integrations/netsuite.mdx'])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual([])
    expect(plan.flags).toMatchObject({
      test_app: true,
      build: false,
      integration: false,
      desktop_live: false,
    })
    expect(plan.testPackages).toEqual(['docs'])
  })
  it('does not build or run E2E for an app unit-test-only edit', () => {
    const plan = classifyFiles(['apps/sim/lib/auth/session.test.ts'])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual([])
    expect(plan.flags).toMatchObject({
      test_app: true,
      integration: false,
      build: false,
      desktop_live: false,
    })
  })
  it('runs a new integration file even when its source domain did not change', () => {
    const plan = classifyFiles(['apps/sim/lib/auth/session.integration.ts'])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual([])
    expect(plan.flags).toMatchObject({ integration: true, test_app: false, build: false })
  })
  it.each([
    'packages/db/vitest.config.ts',
    'packages/db/vitest.integration.setup.ts',
    'apps/realtime/vitest.config.ts',
    'apps/realtime/vitest.integration.setup.ts',
  ])('runs integration checks when sibling collection or setup changes: %s', (file) => {
    const plan = classifyFiles([file])
    expect(plan.fallback).toBeUndefined()
    expect(plan.flags.integration).toBe(true)
  })
  it.each([
    ['test-mobile-e2e.ts', 'mobile'],
    ['test-project-file-sharing-e2e.ts', 'project-files'],
    ['test-scim-e2e.ts', 'scim'],
    ['test-landing-seo-e2e.ts', 'seo'],
  ])('runs the affected acceptance boundary for %s', (file, group) => {
    const plan = classifyFiles([`apps/sim/scripts/${file}`])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual([group])
    expect(plan.flags.http).toBe(group !== 'mobile')
    expect(plan.flags.production).toBe(group === 'mobile')
    expect(plan.flags).toMatchObject({
      test: false,
      build: false,
      integration: false,
      e2e_build: true,
    })
  })
  it('propagates a transitive security dependency to every affected boundary', () => {
    const plan = classifyFiles(['packages/security/src/index.ts'])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual([
      'cli',
      'desktop-inbox',
      'mobile',
      'project-files',
      'scim',
      'seo',
      'stop-after',
    ])
    expect(plan.typecheckPackages).toContain('@sim/app')
    expect(plan.typecheckPackages).toContain('@sim/realtime')
    expect(plan.flags).toMatchObject({
      integration: true,
      desktop_live: true,
      test_app: true,
      build: true,
    })
  })
  it('keeps unknown app modules and non-code fixtures in the shared runtime boundary', () => {
    for (const path of [
      'apps/sim/new-domain/feature.ts',
      'apps/sim/tools/service/__fixtures__/README.md',
    ]) {
      const plan = classifyFiles([path])
      expect(plan.fallback).toBeUndefined()
      expect(plan.flags).toMatchObject({ integration: true, desktop_live: true, e2e_build: true })
    }
  })
  it.each([
    '.github/workflows/checks.yml',
    'scripts/check-example.ts',
    'unknown-root.json',
    'apps/pii/server.py',
  ])('runs all checks for unclassified or orchestration changes: %s', (file) => {
    const plan = classifyFiles([file])
    expect(plan.fallback).toBeTruthy()
    expect(Object.values(plan.flags).every(Boolean)).toBe(true)
  })
  it('keeps the implicit CLI embed dependency in HTTP acceptance', () => {
    const plan = classifyFiles(['packages/sim-cli/src/embed.ts'])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual(['cli'])
    expect(plan.testPackages).toEqual(['sim'])
    expect(plan.flags).toMatchObject({ e2e_build: true, integration: false, desktop_live: false })
  })
  it('runs the shell execution check when its standalone harness changes', () => {
    const plan = classifyFiles(['apps/sim/scripts/test-shell-placeholders-e2e.ts'])
    expect(plan.flags.test_app).toBe(true)
  })
  it('keeps new, unclassified acceptance harnesses in the shared boundary', () => {
    const plan = classifyFiles(['apps/sim/scripts/test-new-feature-e2e.ts'])
    expect(plan.flags).toMatchObject({ test_app: true, integration: true, desktop_live: true })
  })
  it('keeps guidance-only edits on the lint/audit path', () => {
    const plan = classifyFiles([
      'apps/sim/AGENTS.md',
      'packages/security/CLAUDE.md',
      '.claude/rules/example.md',
    ])
    expect(plan.fallback).toBeUndefined()
    expect(Object.values(plan.flags).some(Boolean)).toBe(false)
  })
  it('selects Electron without unrelated app suites for shell-only edits', () => {
    const plan = classifyFiles(['apps/desktop/src/main/menu.ts'])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual([])
    expect(plan.flags).toMatchObject({
      desktop_live: true,
      e2e_build: true,
      integration: false,
      test_app: false,
      build: false,
    })
    expect(plan.testPackages).toEqual(['@sim/desktop'])
  })
  it('runs everything if the real task query cannot parse configuration', () => {
    const { repo, base } = fixture()
    write(repo, 'turbo.json', '{invalid')
    git(repo, 'commit', '--quiet', '-am', 'invalid graph')
    const plan = classify(repo, base)
    expect(plan.fallback).toContain('turbo:')
    expect(Object.values(plan.flags).every(Boolean)).toBe(true)
  })
  it('accounts for both sides of a move out of runtime code', () => {
    const { repo, base } = fixture()
    git(repo, 'mv', 'apps/sim/src/index.ts', 'apps/docs/src/moved.ts')
    git(repo, 'commit', '--quiet', '-am', 'move')
    const plan = classify(repo, base)
    expect(plan.flags).toMatchObject({ integration: true, desktop_live: true, test_app: true })
  })
  it.each(['', '0'.repeat(40)])('runs all checks without a usable base: %j', (base) => {
    const { repo } = fixture()
    expect(Object.values(classify(repo, base).flags).every(Boolean)).toBe(true)
  })
  it('runs all checks on an empty diff', () => {
    const { repo, base } = fixture()
    expect(Object.values(classify(repo, base).flags).every(Boolean)).toBe(true)
  })
})
