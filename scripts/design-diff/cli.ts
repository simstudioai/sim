import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { analyze, emptyReport } from '#design-diff/analyze'
import { GitReader } from '#design-diff/git'
import { Metrics, measurements } from '#design-diff/metrics'
import { serializeReport } from '#design-diff/report'
import { INDEX_VERSION, IndexStore } from '#design-diff/store'
import type { Config, Report } from '#design-diff/types'

const metrics = new Metrics()
let metricsOutput: string | undefined
let index: IndexStore | undefined
let output: string | undefined
let report: Report = emptyReport()
try {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      output: { type: 'string' },
      metrics: { type: 'string' },
      'cache-dir': { type: 'string' },
      'no-cache': { type: 'boolean', default: false },
    },
    strict: true,
  })
  output = values.output
  metricsOutput = values.metrics
  if (!values.base || !values.head) throw new Error('Both --base and --head are required')
  const config = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../design-diff.config.json', import.meta.url)), 'utf8')
  ) as Config
  report.commits = new GitReader(process.cwd()).compare(values.base, values.head)
  report = await measurements.run(metrics, async () => {
    if (values['cache-dir'] && !values['no-cache'])
      index = await IndexStore.open(values['cache-dir'], config)
    return analyze(process.cwd(), report.commits!.base, report.commits!.head, config, index)
  })
} catch {
  report = {
    ...emptyReport(),
    commits: report.commits,
    error:
      'Analysis failed: check arguments, trusted configuration, repository history and resource limits',
  }
  process.exitCode = 1
}
measurements.run(metrics, () => index?.close())
const pr = process.env.DESIGN_DIFF_PR
const engine = process.env.DESIGN_DIFF_ENGINE_SHA
const reportedHead = report.commits?.head ?? process.env.HEAD_SHA
if (pr || engine) {
  if (
    pr &&
    /^[1-9]\d*$/.test(pr) &&
    Number.isSafeInteger(Number(pr)) &&
    engine &&
    /^[a-f0-9]{40}$/.test(engine) &&
    reportedHead &&
    /^[a-f0-9]{40}$/.test(reportedHead)
  ) {
    report.context = { pullRequest: Number(pr), headSha: reportedHead, engineSha: engine }
  } else {
    report.status = 'failed'
    report.flagged = null
    report.error = 'Invalid workflow context'
    process.exitCode = 1
  }
}

try {
  const json = serializeReport(report)
  if (output) {
    mkdirSync(path.dirname(output), { recursive: true })
    const temporary = `${output}.${process.pid}.tmp`
    writeFileSync(temporary, json, { mode: 0o600 })
    renameSync(temporary, output)
  } else process.stdout.write(json)
} catch {
  process.stderr.write('Design diff could not write its report.\n')
  process.exitCode = 1
}

try {
  if (metricsOutput) {
    mkdirSync(path.dirname(metricsOutput), { recursive: true })
    writeFileSync(
      metricsOutput,
      `${JSON.stringify({ engineVersion: report.engineVersion, indexSchemaVersion: INDEX_VERSION, indexIdentity: index?.identity ?? null, commits: report.commits, context: report.context ?? null, ...metrics.snapshot() }, null, 2)}\n`,
      {
        mode: 0o600,
      }
    )
  }
} catch {
  process.stderr.write('Design diff could not write its metrics.\n')
  process.exitCode = 1
}
