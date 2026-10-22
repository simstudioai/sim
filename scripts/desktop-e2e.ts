import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { partitionFiles } from '@scripts/duration-shards'
import { createLogger } from '@sim/logger'
import { escapeRegExp } from '@sim/utils/string'

interface DiscoveryReport {
  config: { rootDir: string }
  suites: { file: string }[]
  errors: unknown[]
}

const logger = createLogger('DesktopE2E')
const match = /^(\d+)\/(\d+)$/.exec(process.argv[2] ?? '')
if (!match) throw new Error('Usage: bun run ../../scripts/desktop-e2e.ts <shard>/<total>')
const index = Number(match[1])
const count = Number(match[2])
if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index < 1 || index > count) {
  throw new Error('Invalid desktop shard index or count')
}

mkdirSync('test-results', { recursive: true })
const discoveryPath = resolve('test-results/desktop-discovery.json')
const discovery = spawnSync('bunx', ['playwright', 'test', '--list', '--reporter=json'], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: discoveryPath },
})
if (discovery.error) throw discovery.error
if (discovery.status !== 0) process.exit(discovery.status ?? 1)
const discoveryJson = readFileSync(discoveryPath, 'utf8')
const report = JSON.parse(discoveryJson) as DiscoveryReport
if (report.errors.length > 0) throw new Error('Playwright discovery reported errors')
// A test factory can declare tests in a helper; the outer suite owns the discoverable test file.
const files = new Set(report.suites.map((suite) => suite.file))
if (count > files.size) throw new Error('More desktop shards than discovered test files')
const durations = JSON.parse(
  readFileSync(new URL('../apps/desktop/e2e-durations.json', import.meta.url), 'utf8')
) as Record<string, number>
const shards = partitionFiles([...files], durations, count)
const selected = shards[index - 1]
if (selected.length === 0) throw new Error('Desktop shard selected no test files')
logger.info(`Running desktop shard ${index}/${count}: ${selected.join(', ')}`)
const run = spawnSync(
  'bunx',
  [
    'playwright',
    'test',
    ...selected.map((file) => `^${escapeRegExp(resolve(report.config.rootDir, file))}$`),
    '--reporter=line,json',
  ],
  { stdio: 'inherit', env: process.env }
)
mkdirSync('test-results', { recursive: true })
writeFileSync(discoveryPath, discoveryJson)
writeFileSync(
  'test-results/desktop-shard-plan.json',
  `${JSON.stringify({ index, count, discoveredFiles: files.size, shards }, null, 2)}\n`
)
if (run.error) throw run.error
process.exit(run.status ?? 1)
