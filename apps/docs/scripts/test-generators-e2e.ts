import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('DocsGeneratorsE2E')
const reportPath = process.env.DOCS_GENERATORS_REPORT_PATH
if (!reportPath || process.env.CI !== 'true')
  throw new Error('Run in an isolated CI checkout with DOCS_GENERATORS_REPORT_PATH configured')
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
await mkdir(dirname(reportPath), { recursive: true })

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
  for (const pass of [1, 2]) {
    for (const command of commands)
      await check(`Pass ${pass}: ${command}`, async () => {
        const output = execFileSync('bun', [command], {
          cwd: root,
          encoding: 'utf8',
          timeout: 180_000,
          maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, DATABASE_URL: '', OPENAI_API_KEY: '' },
        })
        await writeFile(
          resolve(dirname(reportPath), `pass-${pass}-${command.split('/').at(-1)}.log`),
          output
        )
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
    const artifacts: Record<string, string> = {}
    for (const file of ['catalog.json', 'search.json', 'routes.json', 'registry.ts', 'cache.json'])
      artifacts[file] = hash(await readFile(resolve(root, 'apps/docs/.content', file), 'utf8'))
    artifacts.fullMarkdown = hash(
      await readFile(resolve(root, 'apps/docs/public/llms-full.txt'), 'utf8')
    )
    const previousArtifacts = firstArtifacts
    if (previousArtifacts)
      await check('Unchanged second content generation is byte-identical', async () => {
        for (const [file, digest] of Object.entries(previousArtifacts))
          if (artifacts[file] !== digest) throw new Error(`Second generation changed ${file}`)
      })
    else firstArtifacts = artifacts
  }
  await check('Generated source is current on both passes', async () => {
    if (changedFiles.some((files) => files.length))
      throw new Error(`Unexpected generated changes: ${JSON.stringify(changedFiles)}`)
  })
} catch (error) {
  failure = getErrorMessage(error)
  logger.error('Generator verification failed', { error: failure })
  process.exitCode = 1
} finally {
  await writeFile(
    reportPath,
    `${JSON.stringify({ startedAt, completedAt: new Date().toISOString(), revision: git('rev-parse', 'HEAD').trim(), status: failure ? 'failed' : 'passed', failure, changedFiles, results }, null, 2)}\n`
  )
  logger.info('Generator verification complete', { reportPath, checks: results.length })
}
