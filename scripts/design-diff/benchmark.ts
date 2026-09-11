import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { runProcess } from '#design-diff/process'
import type { Report } from '#design-diff/types'

interface Comparison {
  pr: number
  sampleOrder: number
  cohort: 'original' | 'holdout'
  base: string
  head: string
  mergeBase: string
  files: string[]
  label: Record<string, unknown>
}
interface Result {
  pr: number
  cohort: string
  cacheKey: string
  engine: string
  commits: Report['commits']
  status: string
  flagged: boolean | null
  exitCode: number | null
  seconds: number
  timeoutSeconds: number
  peakMemoryBytes: number | null
  reportBytes: number
  reportSha256?: string
  categories: string[]
  findings: number
  error?: string
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

/** Replay frozen Git comparisons using a separately identified immutable trusted engine. */
export async function benchmark(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      engine: { type: 'string' },
      sha: { type: 'string' },
      manifest: { type: 'string' },
      output: { type: 'string' },
      workers: { type: 'string', default: '3' },
      'timeout-seconds': { type: 'string', default: '900' },
    },
    strict: true,
  })
  if (
    !values.engine ||
    !values.sha ||
    !values.manifest ||
    !values.output ||
    !/^[a-f0-9]{40}$/.test(values.sha)
  )
    throw new Error(
      'Required: --engine checkout --sha immutable-sha --manifest frozen.json --output directory'
    )
  const bunVersion = execFileSync(process.execPath, ['--version'], { encoding: 'utf8' }).trim()
  if (bunVersion !== '1.4.1') throw new Error('Benchmark requires Bun 1.4.1')
  const engine = path.resolve(values.engine)
  const output = path.resolve(values.output)
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: engine,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trimEnd()
  if (git('rev-parse', 'HEAD') !== values.sha)
    throw new Error('Engine checkout does not match immutable SHA')
  if (
    git(
      'status',
      '--porcelain',
      '--',
      'scripts/design-diff',
      'design-diff.config.json',
      'bun.lock',
      'package.json'
    )
  )
    throw new Error('Engine/configuration checkout must be clean')
  const manifestBytes = readFileSync(values.manifest)
  const manifest = JSON.parse(manifestBytes.toString()) as { comparisons: Comparison[] }
  if (
    !Array.isArray(manifest.comparisons) ||
    new Set(manifest.comparisons.map((item) => item.pr)).size !== manifest.comparisons.length
  )
    throw new Error('Invalid or duplicate comparison manifest')
  const timeoutSeconds = Number(values['timeout-seconds'])
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600)
    throw new Error('Timeout seconds must be 1..3600')
  const identity = hash(
    JSON.stringify({
      sha: values.sha,
      config: hash(readFileSync(path.join(engine, 'design-diff.config.json'))),
      lock: git('rev-parse', 'HEAD:bun.lock'),
      runtime: bunVersion,
      timeoutSeconds,
    })
  )
  const workers = Number(values.workers)
  if (!Number.isInteger(workers) || workers < 1 || workers > 3)
    throw new Error('Workers must be 1..3')
  mkdirSync(output, { recursive: true })
  writeFileSync(path.join(output, 'manifest.json'), manifestBytes)
  const results: Result[] = []
  const run = async (item: Comparison): Promise<Result> => {
    const commits = { base: item.base, head: item.head, mergeBase: item.mergeBase }
    const cacheKey = hash(JSON.stringify({ identity, commits }))
    const stem = path.join(output, `${item.pr}-${cacheKey}`)
    const reportFile = `${stem}.json`
    const resultFile = `${stem}.result.json`
    const result: Result = {
      pr: item.pr,
      cohort: item.cohort,
      cacheKey,
      engine: values.sha!,
      commits,
      status: 'failed',
      flagged: null,
      exitCode: null,
      seconds: 0,
      timeoutSeconds,
      peakMemoryBytes: null,
      reportBytes: 0,
      categories: [],
      findings: 0,
    }
    try {
      for (const [revision, expected] of [
        [item.base, item.base],
        [item.head, item.head],
      ])
        if (git('rev-parse', `${revision}^{commit}`) !== expected)
          throw new Error('Missing or mismatched history')
      if (git('merge-base', item.base, item.head) !== item.mergeBase)
        throw new Error('Merge-base mismatch')
      const files = git('diff', '--name-only', '-z', item.mergeBase, item.head)
        .split('\0')
        .filter(Boolean)
        .sort()
      if (JSON.stringify(files) !== JSON.stringify([...item.files].sort()))
        throw new Error('Frozen GitHub/Git file set mismatch')
      if (existsSync(resultFile) && existsSync(reportFile)) {
        const cached = JSON.parse(readFileSync(resultFile, 'utf8')) as Result
        if (
          cached.cacheKey === cacheKey &&
          cached.status === 'completed' &&
          cached.reportSha256 === hash(readFileSync(reportFile))
        )
          return cached
      }
      const started = performance.now()
      const env = { ...process.env }
      for (const key of ['DESIGN_DIFF_PR', 'DESIGN_DIFF_ENGINE_SHA', 'HEAD_SHA']) delete env[key]
      const metricsFile = `${stem}.time.txt`
      const timeArgs = process.platform === 'darwin' ? ['-l'] : ['-v', '-o', metricsFile]
      const execution = await runProcess(
        [
          '/usr/bin/time',
          ...timeArgs,
          process.execPath,
          '--no-env-file',
          path.join(engine, 'scripts/design-diff/cli.ts'),
          '--base',
          item.base,
          '--head',
          item.head,
          '--output',
          reportFile,
        ],
        engine,
        env,
        timeoutSeconds * 1000
      )
      result.exitCode = execution.exitCode
      const metrics =
        process.platform === 'linux' && existsSync(metricsFile)
          ? readFileSync(metricsFile, 'utf8')
          : execution.stderr
      if (execution.exitCode !== 0 || execution.timedOut)
        writeFileSync(
          `${stem}.stderr.txt`,
          execution.stderr + (execution.truncated ? '\n[stderr truncated at 65536 bytes]\n' : ''),
          { mode: 0o600 }
        )
      result.seconds = Math.round((performance.now() - started) / 10) / 100
      const rss =
        process.platform === 'darwin'
          ? metrics.match(/(\d+)\s+maximum resident set size/)
          : metrics.match(/Maximum resident set size \(kbytes\):\s*(\d+)/)
      result.peakMemoryBytes = rss
        ? Number(rss[1]) * (process.platform === 'darwin' ? 1 : 1024)
        : null
      if (execution.timedOut) throw new Error('Analysis deadline exceeded')
      if (!existsSync(reportFile)) throw new Error('Engine did not produce a report')
      const bytes = readFileSync(reportFile)
      const report = JSON.parse(bytes.toString()) as Report
      result.reportBytes = bytes.length
      result.reportSha256 = hash(bytes)
      if (
        report.schemaVersion !== '3.0.0' ||
        report.engineVersion !== '0.4.0' ||
        report.policyVersion !== '4.0.0'
      )
        throw new Error('Report version mismatch')
      if (JSON.stringify(report.commits) !== JSON.stringify(commits))
        throw new Error('Report commit mismatch')
      if (bytes.length > 5 * 1024 * 1024) throw new Error('Report size limit exceeded')
      if (result.exitCode !== 0 || report.status !== 'completed' || report.flagged === null)
        throw new Error('Operational analysis failure')
      if (result.peakMemoryBytes === null) throw new Error('Peak memory metric unavailable')
      result.status = report.status
      result.flagged = report.flagged
      result.categories = [
        ...new Set(
          report.findings.flatMap((finding) =>
            finding.decision === 'flag' ? finding.categories : []
          )
        ),
      ].sort()
      result.findings = report.truncation?.findingsTotal ?? report.findings.length
    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Benchmark failure'
    }
    writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`)
    return result
  }
  const pending = [...manifest.comparisons]
  const started = performance.now()
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (pending.length) {
        const item = pending.shift()!
        const result = await run(item)
        results.push(result)
        process.stdout.write(
          `${JSON.stringify({ pr: result.pr, status: result.status, flagged: result.flagged, seconds: result.seconds, peakMemoryBytes: result.peakMemoryBytes })}\n`
        )
      }
    })
  )
  results.sort((a, b) => a.pr - b.pr)
  writeFileSync(
    path.join(output, 'results.json'),
    `${JSON.stringify({ engine: values.sha, identity, manifestSha256: hash(manifestBytes), seconds: Math.round((performance.now() - started) / 10) / 100, results }, null, 2)}\n`
  )
  if (results.some((result) => result.status !== 'completed')) process.exitCode = 1
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
)
  await benchmark().catch(() => {
    process.stderr.write(
      'Benchmark setup failed; check arguments, immutable engine checkout and frozen manifest.\n'
    )
    process.exitCode = 1
  })
