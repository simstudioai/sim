import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../', import.meta.url))
const script = resolve(root, '.github/scripts/ci-changes.sh')
const fixtures: string[] = []
interface Plan {
  base: string
  files: string[]
  flags: Record<string, boolean>
  fallback?: string
  http: { group: string }[]
  production: { group: string }[]
  typecheckPackages: string[]
  testPackages: string[]
  docsGroups: string[]
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
    ['apps/extension', '@sim/extension', {}],
    ['apps/docs', 'docs', { '@sim/workflow-renderer': 'workspace:*' }],
    ['packages/auth', '@sim/auth', { '@sim/security': 'workspace:*' }],
    ['packages/security', '@sim/security', {}],
    ['packages/db', '@sim/db', {}],
    ['packages/sim-setup', 'sim-setup', {}],
    ['packages/sim-cli', 'sim', {}],
    [
      'packages/workflow-renderer',
      '@sim/workflow-renderer',
      { '@sim/workflow-types': 'workspace:*' },
    ],
    ['packages/workflow-types', '@sim/workflow-types', {}],
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
    'apps/desktop/turbo.json',
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
function classify(repo: string, base: string, environment: Record<string, string> = {}): Plan {
  const report = join(repo, 'plan.json')
  const result = spawnSync('bash', [script, base], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF: 'refs/heads/fixture',
      GITHUB_SHA: '',
      ...environment,
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
function pullRequestFixture(files: string[], depth = 2) {
  const { repo: source, base } = fixture()
  git(source, 'checkout', '--quiet', '-b', 'contribution')
  for (const file of files) {
    write(source, file, `${file}\n`)
    git(source, 'add', '-A')
    git(source, 'commit', '--quiet', '-m', `contribute ${file}`)
  }
  git(source, 'checkout', '--quiet', '-b', 'target', base)
  write(source, 'apps/sim/lib/upstream.ts', 'export const upstream = true\n')
  git(source, 'add', '-A')
  git(source, 'commit', '--quiet', '-m', 'advance target')
  const target = git(source, 'rev-parse', 'HEAD')
  git(source, 'merge', '--quiet', '--no-ff', '-m', 'synthetic PR merge', 'contribution')
  const head = git(source, 'rev-parse', 'HEAD')
  const repo = mkdtempSync(join(tmpdir(), 'ci-pr-merge-'))
  fixtures.push(repo)
  git(repo, 'init', '--quiet')
  git(repo, 'remote', 'add', 'origin', pathToFileURL(source).href)
  git(repo, 'fetch', '--quiet', `--depth=${depth}`, 'origin', head)
  git(repo, 'checkout', '--quiet', '--detach', 'FETCH_HEAD')
  expect(git(repo, 'rev-parse', '--is-shallow-repository')).toBe('true')
  return {
    repo,
    base,
    target,
    environment: {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_REF: 'refs/pull/42/merge',
      GITHUB_SHA: head,
    },
  }
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
  it('scopes a shallow multi-commit PR against its tested target after the event base goes stale', () => {
    const files = ['packages/sim-setup/src/index.ts', 'packages/sim-setup/src/second.ts']
    const { repo, base, target, environment } = pullRequestFixture(files)
    const plan = classify(repo, base, environment)
    expect(plan.fallback).toBeUndefined()
    expect(plan.base).toBe(target)
    expect(plan.files).toEqual(files)
    expect(groups(plan)).toEqual([])
    expect(plan.testPackages).toEqual(['sim-setup'])
    expect(plan.typecheckPackages).toEqual(['sim-setup'])
    expect(plan.flags).toMatchObject({
      test: true,
      test_app: false,
      integration: false,
      build: false,
      desktop_live: false,
      e2e_build: false,
      docs: false,
    })
  })
  it('keeps an earlier server change when the final PR commit only changes the setup package', () => {
    const files = ['apps/sim/lib/server.ts', 'packages/sim-setup/src/second.ts']
    const { repo, base, target, environment } = pullRequestFixture(files)
    const plan = classify(repo, base, environment)
    expect(plan.fallback).toBeUndefined()
    expect(plan.base).toBe(target)
    expect(plan.files).toEqual(files)
    expect(plan.testPackages).toContain('sim-setup')
    expect(plan.flags).toMatchObject({
      test_app: true,
      integration: true,
      build: true,
      desktop_live: true,
      e2e_build: true,
    })
  })
  it.each<[string, Record<string, string>]>([
    ['a branch ref', { GITHUB_REF: 'refs/heads/staging' }],
    ['a missing ref', { GITHUB_REF: '' }],
    ['a different triggering SHA', { GITHUB_SHA: 'f'.repeat(40) }],
    ['a missing triggering SHA', { GITHUB_SHA: '' }],
  ])('runs everything for a PR checkout with %s', (_label, invalid) => {
    const { repo, target, environment } = pullRequestFixture(['packages/sim-setup/src/index.ts'])
    const plan = classify(repo, target, { ...environment, ...invalid })
    expect(plan.fallback).toBeDefined()
    expect(Object.values(plan.flags).every(Boolean)).toBe(true)
  })
  it('runs everything if a PR event checks out a non-merge commit', () => {
    const { repo, base } = fixture()
    write(repo, 'packages/sim-setup/src/index.ts', 'export const value = 2\n')
    git(repo, 'commit', '--quiet', '-am', 'setup package change')
    const plan = classify(repo, base, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_REF: 'refs/pull/42/merge',
      GITHUB_SHA: git(repo, 'rev-parse', 'HEAD'),
    })
    expect(plan.fallback).toBeDefined()
    expect(Object.values(plan.flags).every(Boolean)).toBe(true)
  })
  it('runs everything if a shallow PR checkout does not contain its merge parents', () => {
    const { repo, base, environment } = pullRequestFixture(['packages/sim-setup/src/index.ts'], 1)
    const plan = classify(repo, base, environment)
    expect(plan.fallback).toBeDefined()
    expect(Object.values(plan.flags).every(Boolean)).toBe(true)
  })
  it('runs standalone package tests without provisioning the app, browsers, or database', () => {
    const plan = classifyFiles(['packages/sim-setup/src/index.ts'])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual([])
    expect(plan.testPackages).toEqual(['sim-setup'])
    expect(plan.typecheckPackages).toEqual(['sim-setup'])
    expect(plan.flags).toMatchObject({
      test: true,
      test_app: false,
      integration: false,
      build: false,
      desktop_live: false,
      e2e_build: false,
      docs: false,
    })
  })
  it('selects integration and browser checks for workspace code shared with desktop execution', () => {
    const plan = classifyFiles([
      'apps/sim/app/workspace/[workspaceId]/home/hooks/stream/dispatch-stream-event.ts',
    ])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual([
      'assistant-actions',
      'browser-extension-access',
      'browser-extension-composer',
      'browser-extension-navigation',
      'mobile',
      'organization-search',
      'seo',
    ])
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
    ['apps/sim/public/library/example/cover.jpg'],
    ['apps/sim/content/library/example/index.mdx', 'apps/sim/public/library/example/cover.jpg'],
  ])('keeps library media on the rendering and SEO path: %j', (...files) => {
    const plan = classifyFiles(files)
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual(['seo'])
    expect(plan.docsGroups).toEqual([])
    expect(plan.flags).toMatchObject({
      integration: false,
      desktop_live: false,
      production: false,
      test_app: true,
      build: true,
      e2e_build: true,
    })
  })
  it('keeps landing route-group edits on the rendering and SEO path', () => {
    const plan = classifyFiles(['apps/sim/app/(landing)/pricing/page.tsx'])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual(['seo'])
    expect(plan.flags).toMatchObject({
      integration: false,
      desktop_live: false,
      test_app: true,
      build: true,
      e2e_build: true,
    })
  })
  it.each(['delete', 'move'])('keeps SEO coverage when library media is removed: %s', (change) => {
    const { repo } = fixture()
    const media = 'apps/sim/public/library/example/cover.jpg'
    write(repo, media, 'fixture media')
    git(repo, 'add', '-A')
    git(repo, 'commit', '--quiet', '-m', 'media base')
    const base = git(repo, 'rev-parse', 'HEAD')
    if (change === 'delete') git(repo, 'rm', media)
    else git(repo, 'mv', media, 'apps/sim/public/library/example/renamed.jpg')
    git(repo, 'commit', '--quiet', '-m', change)
    const plan = classify(repo, base)
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual(['seo'])
    expect(plan.flags).toMatchObject({
      build: true,
      e2e_build: true,
      integration: false,
      desktop_live: false,
      docs: false,
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
      docs: true,
    })
    expect(plan.testPackages).toEqual(['docs'])
  })
  it('selects docs acceptance for a transitive rendering dependency', () => {
    const plan = classifyFiles(['packages/workflow-types/src/index.ts'])
    expect(plan.fallback).toBeUndefined()
    expect(plan.flags.docs).toBe(true)
    expect(plan.docsGroups).toEqual(['http', 'corpus', 'chromium', 'webkit'])
  })
  it('keeps docs unit-only edits out of production acceptance', () => {
    const plan = classifyFiles(['apps/docs/lib/content/links.test.ts'])
    expect(plan.fallback).toBeUndefined()
    expect(plan.flags.docs).toBe(false)
    expect(plan.testPackages).toEqual(['docs'])
  })
  it('selects docs acceptance for its standalone browser harness', () => {
    const plan = classifyFiles(['apps/docs/scripts/test-navigation-e2e.ts'])
    expect(plan.fallback).toBeUndefined()
    expect(plan.flags.docs).toBe(true)
  })
  it('selects only the platform docs boundary for a consumer harness change', () => {
    const plan = classifyFiles(['apps/sim/scripts/test-docs-search-provider-e2e.ts'])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual([])
    expect(plan.docsGroups).toEqual(['platform'])
    expect(plan.flags).toMatchObject({
      docs: true,
      docs_site: false,
      docs_platform: true,
      test_app: false,
      e2e_build: false,
      integration: false,
      desktop_live: false,
    })
  })
  it('selects platform docs for backend changes without site browser checks', () => {
    const plan = classifyFiles(['apps/sim/lib/mothership/docs/search.ts'])
    expect(plan.fallback).toBeUndefined()
    expect(plan.flags).toMatchObject({ docs: true, docs_site: false, docs_platform: true })
    expect(plan.docsGroups).toEqual(['platform'])
  })
  it('keeps desktop smoke weights out of live runtime attribution', () => {
    const plan = classifyFiles(['apps/desktop/e2e-durations.json'])
    expect(plan.fallback).toBeUndefined()
    expect(plan.flags).toMatchObject({ desktop_live: false, e2e_build: false })
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
    ['test-desktop-inbox-e2e.ts', 'desktop-inbox'],
    ['test-assistant-actions-e2e.ts', 'assistant-actions'],
    ['test-organization-search-e2e.ts', 'organization-search'],
  ])('selects the owning organization acceptance job for %s', (file, group) => {
    const plan = classifyFiles([`apps/sim/scripts/${file}`])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual([group])
    expect(plan.flags).toMatchObject({
      http: true,
      production: false,
      integration: false,
      e2e_build: true,
    })
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
  it('selects every isolated extension group for an extension harness change', () => {
    const plan = classifyFiles(['apps/sim/scripts/test-browser-extension-e2e.ts'])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual([
      'browser-extension-access',
      'browser-extension-composer',
      'browser-extension-navigation',
    ])
    expect(plan.flags).toMatchObject({
      http: true,
      production: false,
      integration: false,
      test: false,
      build: false,
      e2e_build: true,
    })
  })
  it('propagates a transitive security dependency to every affected boundary', () => {
    const plan = classifyFiles(['packages/security/src/index.ts'])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual([
      'assistant-actions',
      'browser-extension-access',
      'browser-extension-composer',
      'browser-extension-navigation',
      'cli',
      'desktop-inbox',
      'mobile',
      'organization-search',
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
  it.each([
    'apps/sim/new-domain/feature.ts',
    'apps/sim/public/new-domain/config.json',
    'apps/sim/public/favicon/favicon.ico',
    'apps/sim/tools/service/__fixtures__/README.md',
  ])('keeps unclassified runtime files in the shared boundary: %s', (path) => {
    const plan = classifyFiles([path])
    expect(plan.fallback).toBeUndefined()
    expect(plan.flags).toMatchObject({ integration: true, desktop_live: true, e2e_build: true })
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
  it('keeps shell-only smoke edits out of the live Sim execution gate', () => {
    const plan = classifyFiles(['apps/desktop/e2e/browser-tools.spec.ts'])
    expect(plan.fallback).toBeUndefined()
    expect(groups(plan)).toEqual([])
    expect(plan.flags).toMatchObject({
      desktop_live: false,
      e2e_build: false,
      integration: false,
      build: false,
    })
  })
  it.each([
    'apps/desktop/e2e/desktop-tools-live-sim.spec.ts',
    'apps/desktop/e2e/fixtures/live-sim.ts',
    'apps/desktop/playwright.config.ts',
  ])('keeps live execution coverage when its harness changes: %s', (file) => {
    const plan = classifyFiles([file])
    expect(plan.fallback).toBeUndefined()
    expect(plan.flags).toMatchObject({ desktop_live: true, e2e_build: true })
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
