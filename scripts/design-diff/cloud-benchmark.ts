import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Prepare a deterministic shard from the pinned engine's frozen manifest. */
try {
  const engine = path.resolve('engine')
  const manifest = JSON.parse(
    readFileSync(path.join(engine, 'scripts/design-diff/benchmark/comparisons.json'), 'utf8')
  )
  const shard = Number(process.env.SHARD)
  if (!Number.isInteger(shard) || shard < 0 || shard >= 180) throw new Error('Invalid shard')
  manifest.comparisons = manifest.comparisons.filter(
    (entry: { sampleOrder: number }) => entry.sampleOrder % 180 === shard
  )
  const commits = [
    ...new Set<string>(
      manifest.comparisons.flatMap((entry: { base: string; head: string }) => [
        entry.base,
        entry.head,
      ])
    ),
  ]
  if (commits.some((commit) => !/^[a-f0-9]{40}$/.test(commit))) throw new Error('Invalid revision')
  writeFileSync(
    path.join(process.env.RUNNER_TEMP!, 'comparisons.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  )
  const authorization = Buffer.from(`x-access-token:${process.env.GH_TOKEN}`).toString('base64')
  execFileSync(
    'git',
    [
      '-c',
      `http.extraheader=AUTHORIZATION: basic ${authorization}`,
      'fetch',
      '--no-tags',
      'origin',
      ...commits,
    ],
    { cwd: engine, stdio: 'ignore' }
  )
  process.stdout.write(
    `Prepared shard ${shard}: ${manifest.comparisons.length} frozen comparisons\n`
  )
} catch {
  process.stderr.write('Benchmark shard preparation failed; no source code was executed.\n')
  process.exitCode = 1
}
