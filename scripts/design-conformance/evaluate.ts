import { mkdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ConformanceLinter } from '#design-conformance/conformance'
import { contractsHash, registry } from '#design-conformance/contracts'
import {
  loadCatalogue,
  manifest,
  options,
  policyOption,
  storedChanges,
  storedText,
  writeJson,
} from '#design-conformance/io'
import { Linter } from '#design-conformance/lint'
import { type Commits, hash, policyVersion, VERSION } from '#design-conformance/model'
import { loadSnapshot } from '#design-conformance/system-snapshot'

interface Row {
  pr: number
  cohort: string
  commits: Commits
  status: string
  flagged: boolean | null
  findings: number
  unchecked: number
  rules: string[]
  categories: string[]
  reportPath: string
  reportSha256: string
  milliseconds: number
}
function statistics(values: number[]) {
  const x = [...values].sort((a, b) => a - b)
  return {
    median: x.length % 2 ? x[(x.length - 1) / 2] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2,
    p95: x[Math.ceil(x.length * 0.95) - 1],
    maximum: x[x.length - 1],
  }
}
process.on('uncaughtException', (error) => {
  process.stderr.write(`Evaluation failed: ${error.message}\n`)
  process.exit(2)
})
process.on('unhandledRejection', (error) => {
  process.stderr.write(`Evaluation failed: ${String(error)}\n`)
  process.exit(2)
})
const args = options({
  dataset: { type: 'string' },
  manifest: { type: 'string' },
  workers: { type: 'string' },
  'worker-index': { type: 'string' },
  'system-snapshots': { type: 'string' },
  'worker-count': { type: 'string' },
})
if (!args.dataset || !args.output)
  throw new Error(
    'Usage: evaluate --dataset <directory> --output <directory> [--manifest <file>] [--workers <number>]'
  )
const dataset = path.resolve(args.dataset as string)
const output = path.resolve(args.output as string)
const frozen = manifest(dataset, args.manifest as string | undefined)
const policy = policyOption(args.policy)
if (policy === 'conformance' && args.catalogue)
  throw new Error('--catalogue is incompatible with conformance; use --system-snapshots')
if (policy === 'conformance' && !args['system-snapshots'])
  throw new Error('Conformance evaluation requires --system-snapshots <directory>')
const cat =
  policy === 'conformance'
    ? {
        hash: contractsHash,
        catalogue: { version: registry.version, sourceCommit: 'per-comparison-merge-base' },
      }
    : loadCatalogue(args.catalogue as string | undefined)
const workers = Number(args.workers ?? 1)
if (
  !Number.isInteger(workers) ||
  workers < 1 ||
  workers > Math.min(os.availableParallelism(), Math.max(1, Math.floor(os.totalmem() / 1024 ** 3)))
)
  throw new Error('Worker count must fit available CPUs and at least 1 GiB memory per process')
mkdirSync(output, { recursive: true })
const started = performance.now()
const index = Number(args['worker-index'] ?? 0)
const workerCount = Number(args['worker-count'] ?? 1)
if (
  !Number.isInteger(index) ||
  !Number.isInteger(workerCount) ||
  index < 0 ||
  workerCount < 1 ||
  index >= workerCount
)
  throw new Error('Invalid worker partition')
if (workers > 1 && !args['worker-index']) {
  const commands = Array.from({ length: workers }, (_, i) => {
    const command = [
      process.execPath,
      '--no-env-file',
      import.meta.filename,
      '--dataset',
      dataset,
      '--output',
      output,
      '--worker-index',
      String(i),
      '--worker-count',
      String(workers),
      '--policy',
      policy,
    ]
    if (args['system-snapshots'])
      command.push('--system-snapshots', args['system-snapshots'] as string)
    if (args.catalogue) command.push('--catalogue', args.catalogue as string)
    if (args.manifest) command.push('--manifest', args.manifest as string)
    return Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' })
  })
  const exits = await Promise.all(commands.map((p) => p.exited))
  if (exits.some((n) => n !== 0))
    throw new Error('Evaluation worker failed; retain available reports')
} else {
  const linter =
    policy === 'conformance'
      ? new ConformanceLinter()
      : await Linter.create(
          loadCatalogue(args.catalogue as string | undefined).catalogue,
          cat.hash,
          policy
        )
  const rows: Row[] = []
  for (const [i, c] of frozen.data.comparisons.entries()) {
    if (i % workerCount !== index) continue
    const start = performance.now()
    const commits = { base: c.base, head: c.head, mergeBase: c.mergeBase }
    let report: ReturnType<Linter['report']>
    try {
      report =
        linter instanceof ConformanceLinter
          ? await linter.analyze(
              storedChanges(dataset, c),
              (e) => storedText(dataset, e),
              commits,
              loadSnapshot(args['system-snapshots'] as string, commits.mergeBase)
            )
          : linter.analyze(storedChanges(dataset, c), (e) => storedText(dataset, e), commits)
    } catch (error) {
      report = linter.report(commits, error instanceof Error ? error.message : 'Source failure')
    }
    const reportPath = `${c.pr}.json`
    writeJson(path.join(output, reportPath), report)
    rows.push({
      pr: c.pr,
      cohort: c.cohort,
      commits,
      status: report.status,
      flagged: report.flagged,
      findings: report.findings.length,
      unchecked: report.unchecked.length,
      rules: [...new Set(report.findings.map((x) => x.rule))].sort(),
      categories: [...new Set(report.findings.map((x) => x.category))].sort(),
      reportPath,
      reportSha256: hash(readFileSync(path.join(output, reportPath))),
      milliseconds: performance.now() - start,
    })
    if (rows.length % 30 === 0)
      process.stdout.write(`Checked ${rows.length} comparisons in worker ${index}\n`)
  }
  writeJson(path.join(output, `worker-${index}.json`), {
    rows,
    milliseconds: performance.now() - started,
    peakMemoryBytes: process.resourceUsage().maxRSS * 1024,
    metrics: linter.metrics,
  })
  if (args['worker-index']) process.exit(0)
}
const parts = Array.from({ length: workers }, (_, i) =>
  JSON.parse(readFileSync(path.join(output, `worker-${i}.json`), 'utf8'))
)
const rows: Row[] = parts
  .flatMap((p) => p.rows)
  .sort(
    (a: Row, b: Row) =>
      frozen.data.comparisons.findIndex((x) => x.pr === a.pr) -
      frozen.data.comparisons.findIndex((x) => x.pr === b.pr)
  )
if (
  rows.length !== frozen.data.comparisons.length ||
  new Set(rows.map((x) => x.pr)).size !== rows.length
)
  throw new Error('Missing or duplicate comparison result')
const count = (key: 'rules' | 'categories') => {
  const out: Record<string, number> = {}
  for (const r of rows) for (const v of r[key]) out[v] = (out[v] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort())
}
const summary = {
  toolVersion: VERSION,
  policyVersion: policyVersion(policy),
  implementationHash: JSON.parse(readFileSync(path.join(output, rows[0].reportPath), 'utf8'))
    .implementationHash,
  catalogueHash: cat.hash,
  catalogueVersion: cat.catalogue.version,
  catalogueSourceCommit: cat.catalogue.sourceCommit,
  datasetId: frozen.data.datasetId,
  manifestSha256: frozen.hash,
  workers,
  comparisons: rows.length,
  completed: rows.filter((x) => x.status === 'completed').length,
  failed: rows.filter((x) => x.status === 'failed').map((x) => x.pr),
  flagged: rows.filter((x) => x.flagged).length,
  uncheckedComparisons: rows.filter((x) => x.unchecked > 0).length,
  uncheckedDiagnostics: rows.reduce((n, r) => n + r.unchecked, 0),
  cohorts: Object.fromEntries(
    [...new Set(rows.map((x) => x.cohort))].map((cohort) => [
      cohort,
      {
        total: rows.filter((x) => x.cohort === cohort).length,
        flagged: rows.filter((x) => x.cohort === cohort && x.flagged).length,
      },
    ])
  ),
  rules: count('rules'),
  categories: count('categories'),
  milliseconds: performance.now() - started,
  comparisonMilliseconds: statistics(rows.map((x) => x.milliseconds)),
  peakWorkerMemoryBytes: Math.max(...parts.map((x) => x.peakMemoryBytes)),
  metrics: parts.map((x) => x.metrics),
  note: 'Source-only design conformance, appearance comparisons or legacy token compliance; prior appearance labels are not conformance ground truth.',
}
writeJson(path.join(output, 'results.json'), rows)
writeJson(path.join(output, 'evaluation.json'), summary)
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
process.exitCode = summary.failed.length ? 2 : 0
