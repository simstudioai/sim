import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Plans CI from Turborepo's task inputs without installing or executing application code. */
interface Suite {
  task: string
  group: string
  [key: string]: string
}
interface ChangedTask {
  name: string
  fullName: string
  package: { name: string }
  reason: Record<string, string>
}
interface QueryResult {
  errors?: unknown[]
  data?: {
    packages: { items: { name: string; path: string }[] }
    affectedTasks: { items: ChangedTask[] }
  }
}
const root = process.cwd()
const suites: { http: Suite[]; production: Suite[] } = JSON.parse(
  readFileSync(resolve(root, '.github/ci-suites.json'), 'utf8')
)
const sourceBase = process.argv[2]
let files: string[] = []
let tasks: ChangedTask[] = []
let base = sourceBase
let fallback: string | undefined

function command(program: string, args: string[]): string {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', timeout: 60_000 })
  if (result.status !== 0)
    throw new Error(`${program}: ${result.stderr || result.error || result.status}`)
  return result.stdout.trim()
}

try {
  if (!sourceBase)
    throw new Error('No comparison base; push and unscoped dispatch run the full suite')
  if (!/^[0-9a-f]{40}$/.test(sourceBase))
    throw new Error('Comparison base must be a full commit SHA')
  try {
    command('git', ['cat-file', '-e', `${sourceBase}^{commit}`])
  } catch {
    command('git', ['fetch', '--quiet', '--depth=2', 'origin', sourceBase])
  }
  base = command('git', ['merge-base', sourceBase, 'HEAD'])
  files = command('git', ['diff', '--no-renames', '--name-only', '-z', base, 'HEAD'])
    .split('\0')
    .filter(Boolean)
  if (files.length === 0) throw new Error('Empty diff; verify the complete suite')
  if (files.some((file) => /^(\.github\/|scripts\/)/.test(file)))
    throw new Error('CI orchestration or root scripts changed')
  const temp = mkdtempSync(join(tmpdir(), 'sim-ci-plan-'))
  let result: QueryResult
  try {
    const variables = join(temp, 'variables.json')
    writeFileSync(variables, JSON.stringify({ base, head: 'HEAD' }))
    result = JSON.parse(
      command('turbo', ['query', '.github/scripts/ci-plan.gql', '--variables', variables])
    )
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
  if (
    result.errors?.length ||
    !Array.isArray(result.data?.affectedTasks?.items) ||
    !Array.isArray(result.data?.packages?.items)
  )
    throw new Error('Turborepo did not return a complete task plan')
  const workspacePaths = result.data.packages.items
    .filter((pkg) => pkg.name !== '//')
    .map((pkg) => `${pkg.path}/`)
  const guidance = /^(\.agents|\.claude|\.cursor)\/|(^|\/)(AGENTS|CLAUDE)\.md$|^README\.md$/
  const unowned = files.find(
    (file) => !guidance.test(file) && !workspacePaths.some((path) => file.startsWith(path))
  )
  if (unowned) throw new Error(`Changed file outside the workspace graph: ${unowned}`)
  tasks = result.data.affectedTasks.items
  if (
    tasks.some(
      (task) => typeof task.fullName !== 'string' || typeof task.package?.name !== 'string'
    )
  )
    throw new Error('Malformed task attribution')
} catch (error) {
  fallback = String(error)
}

const selected = new Set(tasks.map((task) => task.fullName))
const affected = (task: string) => fallback !== undefined || selected.has(`@sim/app#${task}`)
const http = suites.http.filter((suite) => affected(suite.task))
const production = suites.production.filter((suite) => affected(suite.task))
const desktopLive = affected('ci:desktop-live')
const appTest = affected('test')
function taskPackages(name: string, omitApp = false): string[] {
  return fallback
    ? ['*']
    : [
        ...new Set(
          tasks
            .filter((task) => task.name === name && (!omitApp || task.package.name !== '@sim/app'))
            .map((task) => task.package.name)
        ),
      ].sort()
}
const packages = taskPackages('test', true)
const typecheckPackages = taskPackages('type-check')
const flags = {
  integration: affected('ci:integration'),
  http: http.length > 0,
  production: production.length > 0,
  e2e_build: http.length > 0 || production.length > 0 || desktopLive,
  desktop_live: desktopLive,
  test: appTest || packages.length > 0,
  test_app: appTest,
  build: affected('build'),
}
const outputs = {
  ...Object.fromEntries(Object.entries(flags).map(([key, value]) => [key, String(value)])),
  http_matrix: JSON.stringify({ include: http }),
  production_matrix: JSON.stringify({ include: production }),
  test_matrix: JSON.stringify({ shard: appTest ? [1, 2] : [1] }),
  test_packages: JSON.stringify(packages),
  typecheck_packages: JSON.stringify(typecheckPackages),
}
const report = {
  base,
  head: command('git', ['rev-parse', 'HEAD']),
  files,
  fallback,
  tasks,
  flags,
  http,
  production,
  testPackages: packages,
  typecheckPackages,
}
if (process.env.CI_PLAN_PATH)
  writeFileSync(process.env.CI_PLAN_PATH, `${JSON.stringify(report, null, 2)}\n`)
process.stderr.write(
  `${fallback ? `Full CI: ${fallback}` : `Affected CI: ${tasks.map((task) => task.fullName).join(', ') || 'no executable tasks'}`}\n`
)
process.stdout.write(
  Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('')
)
