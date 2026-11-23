import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { compareStrings } from '@sim/utils/string'
import type { ContentCatalog } from '@/lib/content/types'

const logger = createLogger('DocsGeneratorsE2E')
const reportSetting = process.env.DOCS_GENERATORS_REPORT_PATH
if (!reportSetting || process.env.CI !== 'true')
  throw new Error('Run in an isolated CI checkout with DOCS_GENERATORS_REPORT_PATH configured')
const reportPath: string = reportSetting
const root = resolve(import.meta.dirname, '../../..')
const startedAt = new Date().toISOString()
const commands = [
  'scripts/generate-openapi.ts',
  'scripts/generate-v2-cli-api.ts',
  'scripts/generate-cli-docs.ts',
  'scripts/generate-v2-mcp-operations.ts',
  'scripts/generate-v2-route-table.ts',
  'scripts/sync-agent-stream-docs.ts',
  'scripts/generate-docs.ts',
  'scripts/sync-docs-manifest.ts',
  'apps/docs/scripts/compile-content.ts',
] as const
const results: Array<{
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}> = []
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const changedFiles: string[][] = []
let failure: string | undefined
const fixturePath = resolve(root, 'apps/docs/content/docs/ci-cache-fixture.mdx')
let createdFixture = false
await mkdir(dirname(reportPath), { recursive: true })

async function runGenerator(command: string, logName: string) {
  const output = execFileSync(
    'bun',
    [command, ...(command === 'apps/docs/scripts/compile-content.ts' ? ['--prune'] : [])],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, DATABASE_URL: '', OPENAI_API_KEY: '' },
    }
  )
  await writeFile(resolve(dirname(reportPath), logName), output)
}

async function contentArtifacts() {
  const artifacts: Record<string, string> = {}
  for (const file of [
    'catalog.json',
    'search.json',
    'search-catalog.json',
    'routes.json',
    'registry.ts',
    'cache.json',
  ])
    artifacts[file] = hash(await readFile(resolve(root, 'apps/docs/.content', file), 'utf8'))
  artifacts.fullMarkdown = hash(
    await readFile(resolve(root, 'apps/docs/public/llms-full.txt'), 'utf8')
  )
  const modules = createHash('sha256')
  const directory = resolve(root, 'apps/docs/.content/pages')
  for (const file of (await readdir(directory)).sort(compareStrings))
    modules.update(`${file}\0`).update(await readFile(resolve(directory, file)))
  artifacts.modules = modules.digest('hex')
  return artifacts
}

async function authoredRegions() {
  const regions: Record<string, string> = {}
  const files = git('ls-files', 'apps/docs/content/docs/**/*.mdx').trim().split('\n')
  for (const file of files) {
    const text = await readFile(resolve(root, file), 'utf8')
    for (const match of text.matchAll(
      /\{\/\*\s*MANUAL-CONTENT-START:(\w+)\s*\*\/\}([\s\S]*?)\{\/\*\s*MANUAL-CONTENT-END\s*\*\/\}/g
    ))
      regions[`${file}:${match[1]}`] = hash(match[2])
  }
  return regions
}

async function check(name: string, action: () => Promise<void>) {
  const started = performance.now()
  try {
    await action()
    results.push({ name, status: 'passed', durationMs: performance.now() - started })
  } catch (error) {
    results.push({
      name,
      status: 'failed',
      durationMs: performance.now() - started,
      error: getErrorMessage(error),
    })
    throw error
  }
}

try {
  if (git('status', '--porcelain', '--untracked-files=all').trim())
    throw new Error('Generator verification requires a clean checkout')
  const regionsBefore = await authoredRegions()
  let firstArtifacts: Record<string, string> | undefined
  let missingDeclaration: string | undefined
  for (const pass of [1, 2]) {
    if (pass === 2) {
      const directory = resolve(root, 'apps/docs/.content/pages')
      const declaration = (await readdir(directory)).find((file) => file.endsWith('.d.ts'))
      if (!declaration) throw new Error('No compiled declaration is available for recovery')
      missingDeclaration = resolve(directory, declaration)
      await rm(missingDeclaration)
      for (const suffix of ['js', 'd.ts'])
        await writeFile(
          resolve(root, 'apps/docs/.content/pages', `obsolete-page.${suffix}`),
          'obsolete compiled page'
        )
    }
    for (const command of commands)
      await check(`Pass ${pass}: ${command}`, async () => {
        await runGenerator(command, `pass-${pass}-${command.split('/').at(-1)}.log`)
      })
    if (missingDeclaration)
      await check('A partial content cache regenerates its missing declaration', async () => {
        if (!missingDeclaration) throw new Error('The missing declaration fixture is unavailable')
        await access(missingDeclaration)
      })
    const diff = git('diff', '--binary')
    changedFiles.push([
      ...git('diff', '--name-only').trim().split('\n').filter(Boolean),
      ...git('ls-files', '--others', '--exclude-standard').trim().split('\n').filter(Boolean),
    ])
    await writeFile(resolve(dirname(reportPath), `pass-${pass}.patch`), diff)
    await check(`Pass ${pass}: authored regions preserved`, async () => {
      const regionsAfter = await authoredRegions()
      for (const [name, digest] of Object.entries(regionsBefore))
        if (regionsAfter[name] !== digest) throw new Error(`Authored region changed: ${name}`)
    })
    const artifacts = await contentArtifacts()
    const previousArtifacts = firstArtifacts
    if (previousArtifacts)
      await check('Unchanged second content generation is byte-identical', async () => {
        for (const [file, digest] of Object.entries(previousArtifacts))
          if (artifacts[file] !== digest) throw new Error(`Second generation changed ${file}`)
      })
    else firstArtifacts = artifacts
  }
  await check('Content generation removes obsolete cached page modules', async () => {
    for (const suffix of ['js', 'd.ts']) {
      const obsoletePage = resolve(root, 'apps/docs/.content/pages', `obsolete-page.${suffix}`)
      if (
        await access(obsoletePage).then(
          () => true,
          () => false
        )
      )
        throw new Error(`Obsolete compiled page remains: ${obsoletePage}`)
    }
  })
  await check('Generated source is current on both passes', async () => {
    if (changedFiles.some((files) => files.length))
      throw new Error(`Unexpected generated changes: ${JSON.stringify(changedFiles)}`)
  })
  const originalModules = (await readdir(resolve(root, 'apps/docs/.content/pages'))).sort(
    compareStrings
  )
  const readCatalog = async () =>
    JSON.parse(
      await readFile(resolve(root, 'apps/docs/.content/catalog.json'), 'utf8')
    ) as ContentCatalog
  const fixture = (version: string) =>
    `---\ntitle: CI cache fixture\ndescription: Incremental compilation fixture\n---\n\n${version}\n`
  await check('New authored content is published from a warm cache', async () => {
    if (
      await access(fixturePath).then(
        () => true,
        () => false
      )
    )
      throw new Error('The incremental compilation fixture already exists')
    createdFixture = true
    await writeFile(fixturePath, fixture('First fixture revision.'))
    await runGenerator('apps/docs/scripts/compile-content.ts', 'cache-create.log')
    const page = (await readCatalog()).pages.find((page) => page.id === '/ci-cache-fixture')
    if (!page?.markdown.includes('First fixture revision.'))
      throw new Error('The new authored page was not published')
  })
  await check('Changed authored content invalidates its cached output', async () => {
    await writeFile(fixturePath, fixture('Second fixture revision.'))
    await runGenerator('apps/docs/scripts/compile-content.ts', 'cache-edit.log')
    const page = (await readCatalog()).pages.find((page) => page.id === '/ci-cache-fixture')
    if (
      !page?.markdown.includes('Second fixture revision.') ||
      page.markdown.includes('First fixture revision.')
    )
      throw new Error('The old authored content survived recompilation')
  })
  await check('Deleted authored content leaves no catalog entry or cached modules', async () => {
    await rm(fixturePath)
    await runGenerator('apps/docs/scripts/compile-content.ts', 'cache-delete.log')
    const modules = (await readdir(resolve(root, 'apps/docs/.content/pages'))).sort(compareStrings)
    if (JSON.stringify(modules) !== JSON.stringify(originalModules))
      throw new Error('The compiled module inventory changed after the fixture was removed')
    const restored = await contentArtifacts()
    if (JSON.stringify(restored) !== JSON.stringify(firstArtifacts))
      throw new Error('Deleting the fixture did not restore the original generated artifacts')
  })
} catch (error) {
  failure = getErrorMessage(error)
  logger.error('Generator verification failed', { error: failure })
  process.exitCode = 1
} finally {
  if (createdFixture) await rm(fixturePath, { force: true })
  await writeFile(
    reportPath,
    `${JSON.stringify({ startedAt, completedAt: new Date().toISOString(), revision: git('rev-parse', 'HEAD').trim(), status: failure ? 'failed' : 'passed', failure, changedFiles, results }, null, 2)}\n`
  )
  logger.info('Generator verification complete', { reportPath, checks: results.length })
}
